import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FRASE_SEM_ORIGEM,
  FRASE_SEM_TITULAR,
  ROTA_DE_CONSENTIMENTOS,
  chaveDoTitular,
  chipsDosConsentimentos,
  estadoAtualPorTitular,
  formularioDeConsentimentoVazio,
  identificarTitular,
  lerEstado,
  montarConsulta,
  montarPayloadDeConsentimento,
  quemConsenteHoje,
  temFiltro,
  urlDaTela,
  validarConsentimento,
  type Consentimento,
  type EstadoDosConsentimentos,
  type FormularioDeConsentimento,
} from "./consentimentos.logica";

let contador = 0;

function linha(sobrescreve: Partial<Consentimento> = {}): Consentimento {
  contador += 1;
  return {
    id: `cccccccc-cccc-cccc-cccc-${String(contador).padStart(12, "0")}`,
    user_id: null,
    email: "ana@exemplo.com",
    telefone: null,
    canal: "whatsapp",
    estado: "concedido",
    origem: "rodapé do site",
    texto_aceito: null,
    ip: null,
    criado_em: "2026-01-10T12:00:00.000Z",
    ...sobrescreve,
  };
}

function estado(
  sobrescreve: Partial<EstadoDosConsentimentos> = {},
): EstadoDosConsentimentos {
  return { canal: "", estado: "", pagina: 1, ...sobrescreve };
}

function formulario(
  sobrescreve: Partial<FormularioDeConsentimento> = {},
): FormularioDeConsentimento {
  return {
    canal: "whatsapp",
    estado: "concedido",
    origem: "conversa no balcão",
    email: "ana@exemplo.com",
    telefone: "",
    ...sobrescreve,
  };
}

/* ========================================================================== *
 * As frases copiadas
 * ========================================================================== */

describe("as frases da validação local são as do backend, ao caractere", () => {
  const REPOSITORIO = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "backend",
      "src",
      "repositories",
      "marketingRepository.js",
    ),
    "utf8",
  );

  it("a frase de origem ausente existe literalmente no Express", () => {
    expect(REPOSITORIO).toContain(FRASE_SEM_ORIGEM);
  });

  /**
   * Esta frase o backend usa e a TELA NÃO — ela cita `user_id`, que quem
   * registra à mão não tem na frente. A constante existe para o teste provar
   * que a frase do servidor continua sendo aquela; se ela mudar, quem mexer vê
   * este teste e decide de novo o que a tela deve dizer.
   */
  it("a frase de titular ausente do servidor continua sendo a que a tela conhece", () => {
    expect(REPOSITORIO).toContain(FRASE_SEM_TITULAR);
  });
});

/* ========================================================================== *
 * O estado da lista — e o e-mail que NÃO entra na URL
 * ========================================================================== */

describe("lerEstado", () => {
  it("lê canal, estado e página", () => {
    expect(lerEstado({ canal: "email", estado: "revogado", pagina: "2" })).toEqual({
      canal: "email",
      estado: "revogado",
      pagina: 2,
    });
  });

  it("valor fora do vocabulário vira sem filtro, e não um 400 na cara do gestor", () => {
    expect(lerEstado({ canal: "pombo" }).canal).toBe("");
    expect(lerEstado({ estado: "talvez" }).estado).toBe("");
  });

  /**
   * A RESSALVA DO R2, e ela pesa mais que a regra nesta tela: uma URL de painel
   * vai para o histórico do navegador, para o `Referer` e para o print que
   * alguém cola num grupo. Numa tela de conformidade, isso seria a ferramenta
   * vazando o dado que ela existe para proteger.
   */
  it("o e-mail NUNCA entra no estado da URL, mesmo se alguém o puser lá", () => {
    const lido = lerEstado({ email: "ana@exemplo.com", q: "ana@exemplo.com" });
    expect(Object.values(lido)).not.toContain("ana@exemplo.com");
    expect(JSON.stringify(lido)).not.toContain("@");
  });

  it("e a URL montada pela tela também não o carrega", () => {
    expect(urlDaTela(estado({ canal: "email" }))).not.toContain("@");
  });
});

describe("montarConsulta", () => {
  it("bate na rota de consentimentos com o limite da tela", () => {
    expect(montarConsulta(estado())).toBe("/admin/consentimentos?page=1&limit=20");
  });

  it("leva canal e estado quando existem", () => {
    const c = montarConsulta(estado({ canal: "whatsapp", estado: "concedido" }));
    expect(c).toContain("canal=whatsapp");
    expect(c).toContain("estado=concedido");
  });
});

describe("chipsDosConsentimentos", () => {
  it("sem filtro, nenhum chip", () => {
    expect(chipsDosConsentimentos(estado())).toEqual([]);
    expect(temFiltro(estado())).toBe(false);
  });

  it("mostra rótulos, não valores crus", () => {
    const chips = chipsDosConsentimentos(
      estado({ canal: "email", estado: "revogado" }),
    );
    expect(chips.map((c) => c.valor)).toEqual(["E-mail", "Revogado"]);
    expect(temFiltro(estado({ canal: "email" }))).toBe(true);
  });

  it("remover um chip preserva o outro e volta para a página 1", () => {
    const chips = chipsDosConsentimentos(
      estado({ canal: "email", estado: "revogado", pagina: 5 }),
    );
    const doCanal = chips.find((c) => c.chave === "canal")!;
    expect(doCanal.href).toContain("estado=revogado");
    expect(doCanal.href).not.toContain("canal=");
    expect(doCanal.href).not.toContain("pagina=");
  });

  it("a rota dos chips é a da tela de consentimentos", () => {
    expect(chipsDosConsentimentos(estado({ canal: "email" }))[0].href).toContain(
      ROTA_DE_CONSENTIMENTOS,
    );
  });
});

/* ========================================================================== *
 * A identidade do titular
 * ========================================================================== */

describe("chaveDoTitular", () => {
  it("prefere user_id — é imutável e é o mesmo titular em qualquer canal", () => {
    expect(
      chaveDoTitular(
        linha({ user_id: "11111111-1111-1111-1111-111111111111", email: "a@b.c" }),
      ),
    ).toBe("id:11111111-1111-1111-1111-111111111111");
  });

  it("sem user_id, o e-mail — normalizado, porque o índice do banco é lower()", () => {
    expect(chaveDoTitular(linha({ email: "Ana@Exemplo.COM" }))).toBe(
      "email:ana@exemplo.com",
    );
  });

  /**
   * "Ana@Ex.com" e "ana@ex.com" são a MESMA caixa postal. Sem normalizar, a
   * pessoa que concedeu com uma grafia e revogou com a outra viraria dois
   * titulares — e o revogado não cancelaria o concedido.
   */
  it("duas grafias do mesmo e-mail são o mesmo titular", () => {
    expect(chaveDoTitular(linha({ email: "Ana@Ex.com" }))).toBe(
      chaveDoTitular(linha({ email: "ana@ex.com" })),
    );
  });

  it("por último o telefone, e só os dígitos", () => {
    expect(
      chaveDoTitular(linha({ email: null, telefone: "(35) 99999-8888" })),
    ).toBe("tel:35999998888");
  });

  it("duas grafias do mesmo telefone são o mesmo titular", () => {
    expect(chaveDoTitular(linha({ email: null, telefone: "35 99999-8888" }))).toBe(
      chaveDoTitular(linha({ email: null, telefone: "(35)999998888" })),
    );
  });

  /** O CHECK do banco impede; a chave existe para uma linha corrompida não
   *  virar um titular "undefined" agrupando a base inteira num só. */
  it("linha sem identificação nenhuma cai numa chave única, e não numa comum", () => {
    const a = chaveDoTitular(linha({ user_id: null, email: null, telefone: null }));
    const b = chaveDoTitular(linha({ user_id: null, email: null, telefone: null }));
    expect(a).not.toBe(b);
    expect(a).toContain("sem-identificacao");
  });
});

describe("identificarTitular — R23, identificador humano", () => {
  it("mostra o e-mail quando há", () => {
    expect(identificarTitular(linha({ email: "ana@exemplo.com" }))).toBe(
      "ana@exemplo.com",
    );
  });

  it("cai no telefone, depois numa frase — nunca num UUID", () => {
    expect(identificarTitular(linha({ email: null, telefone: "35999998888" }))).toBe(
      "35999998888",
    );
    const soComConta = identificarTitular(
      linha({ email: null, telefone: null, user_id: "11111111-1111-1111-1111-111111111111" }),
    );
    expect(soComConta).not.toContain("1111");
  });
});

/* ========================================================================== *
 * O ESTADO DE HOJE — a redução que impede o disparo indevido
 * ========================================================================== */

describe("estadoAtualPorTitular", () => {
  /**
   * O DEFEITO QUE ESTA FUNÇÃO EXISTE PARA IMPEDIR. As duas linhas existem, as
   * duas são verdadeiras, e só a segunda vale. Um público montado com o filtro
   * cru do backend (`estado=concedido`) inclui quem pediu para parar.
   */
  it("concedeu em janeiro e revogou em março: hoje vale REVOGADO", () => {
    const atual = estadoAtualPorTitular([
      linha({ estado: "concedido", criado_em: "2026-01-10T12:00:00.000Z" }),
      linha({ estado: "revogado", criado_em: "2026-03-10T12:00:00.000Z" }),
    ]);
    expect([...atual.values()][0].estado).toBe("revogado");
  });

  it("revogou e concedeu de novo: hoje vale CONCEDIDO", () => {
    const atual = estadoAtualPorTitular([
      linha({ estado: "concedido", criado_em: "2026-01-10T12:00:00.000Z" }),
      linha({ estado: "revogado", criado_em: "2026-03-10T12:00:00.000Z" }),
      linha({ estado: "concedido", criado_em: "2026-06-10T12:00:00.000Z" }),
    ]);
    expect([...atual.values()][0].estado).toBe("concedido");
  });

  /**
   * Depender da ordem da resposta é depender de um `ORDER BY` que vive noutro
   * repositório — e que a paginação pode partir ao meio.
   */
  it("não depende da ordem da entrada", () => {
    const a = linha({ estado: "concedido", criado_em: "2026-01-10T12:00:00.000Z" });
    const b = linha({ estado: "revogado", criado_em: "2026-03-10T12:00:00.000Z" });
    expect([...estadoAtualPorTitular([a, b]).values()][0].estado).toBe("revogado");
    expect([...estadoAtualPorTitular([b, a]).values()][0].estado).toBe("revogado");
  });

  /** Canal é dimensão: revogar WhatsApp não revoga e-mail. */
  it("separa por CANAL — cada canal tem o seu estado de hoje", () => {
    const atual = estadoAtualPorTitular([
      linha({ canal: "whatsapp", estado: "revogado", criado_em: "2026-03-10T12:00:00.000Z" }),
      linha({ canal: "email", estado: "concedido", criado_em: "2026-01-10T12:00:00.000Z" }),
    ]);
    expect(atual.size).toBe(2);
    const porCanal = Object.fromEntries(
      [...atual.values()].map((a) => [a.canal, a.estado]),
    );
    expect(porCanal).toEqual({ whatsapp: "revogado", email: "concedido" });
  });

  it("separa por TITULAR — a revogação de um não alcança o outro", () => {
    const atual = estadoAtualPorTitular([
      linha({ email: "ana@ex.com", estado: "revogado" }),
      linha({ email: "bia@ex.com", estado: "concedido" }),
    ]);
    expect(atual.size).toBe(2);
  });

  it("guarda a linha DECISIVA, com a data e a origem que explicam a decisão", () => {
    const decisiva = linha({
      estado: "revogado",
      criado_em: "2026-03-10T12:00:00.000Z",
      origem: "pedido por e-mail ao SAC",
    });
    const atual = estadoAtualPorTitular([
      linha({ estado: "concedido", criado_em: "2026-01-10T12:00:00.000Z" }),
      decisiva,
    ]);
    expect([...atual.values()][0].decisiva.id).toBe(decisiva.id);
    expect([...atual.values()][0].decisiva.origem).toBe("pedido por e-mail ao SAC");
  });

  /** Uma linha com `criado_em` corrompido não pode virar a palavra final. */
  it("data ilegível não desbanca uma legível, venha na ordem que vier", () => {
    const boa = linha({ estado: "revogado", criado_em: "2026-03-10T12:00:00.000Z" });
    const ruim = linha({ estado: "concedido", criado_em: "não é data" });
    expect([...estadoAtualPorTitular([boa, ruim]).values()][0].estado).toBe("revogado");
    expect([...estadoAtualPorTitular([ruim, boa]).values()][0].estado).toBe("revogado");
  });

  it("histórico vazio devolve mapa vazio", () => {
    expect(estadoAtualPorTitular([]).size).toBe(0);
  });
});

describe("quemConsenteHoje", () => {
  it("devolve só os concedidos VIGENTES daquele canal", () => {
    const vigentes = quemConsenteHoje(
      [
        linha({ email: "ana@ex.com", canal: "whatsapp", estado: "concedido" }),
        linha({
          email: "bia@ex.com",
          canal: "whatsapp",
          estado: "concedido",
          criado_em: "2026-01-01T12:00:00.000Z",
        }),
        linha({
          email: "bia@ex.com",
          canal: "whatsapp",
          estado: "revogado",
          criado_em: "2026-02-01T12:00:00.000Z",
        }),
        linha({ email: "caio@ex.com", canal: "email", estado: "concedido" }),
      ],
      "whatsapp",
    );
    expect(vigentes.map((v) => v.chave)).toEqual(["email:ana@ex.com"]);
  });

  it("canal sem ninguém devolve lista vazia, e não a base inteira", () => {
    expect(quemConsenteHoje([linha({ canal: "email" })], "sms")).toEqual([]);
  });
});

/* ========================================================================== *
 * O registro
 * ========================================================================== */

describe("formularioDeConsentimentoVazio", () => {
  it("nasce sem canal — a escolha é da pessoa", () => {
    expect(formularioDeConsentimentoVazio().canal).toBe("");
  });

  it("nasce em «concedido»: registrar à mão é quase sempre registrar um sim", () => {
    expect(formularioDeConsentimentoVazio().estado).toBe("concedido");
  });
});

describe("validarConsentimento", () => {
  it("o formulário completo não tem erro", () => {
    expect(validarConsentimento(formulario())).toEqual({});
  });

  it("origem em branco usa a frase do servidor — é a procedência que a LGPD pede", () => {
    expect(validarConsentimento(formulario({ origem: "  " })).origem).toBe(
      FRASE_SEM_ORIGEM,
    );
  });

  it("canal e estado fora do vocabulário reprovam", () => {
    expect(validarConsentimento(formulario({ canal: "" })).canal).toBeTruthy();
    expect(validarConsentimento(formulario({ estado: "talvez" })).estado).toBeTruthy();
  });

  it("sem e-mail e sem telefone reprova — o CHECK do banco exige um dos dois", () => {
    expect(
      validarConsentimento(formulario({ email: "", telefone: "" })).email,
    ).toBeTruthy();
  });

  it("só telefone basta, e só e-mail basta", () => {
    expect(validarConsentimento(formulario({ email: "", telefone: "35999998888" }))).toEqual({});
    expect(validarConsentimento(formulario({ telefone: "" }))).toEqual({});
  });
});

describe("montarPayloadDeConsentimento", () => {
  it("o e-mail sai em minúscula — o índice do banco é sobre lower(email)", () => {
    expect(montarPayloadDeConsentimento(formulario({ email: "Ana@EX.com" })).email).toBe(
      "ana@ex.com",
    );
  });

  /**
   * A tabela é PROVA: guarda-se o que a pessoa forneceu. Normalizar aqui
   * gravaria para sempre um número adivinhado; a normalização para disparo
   * acontece em `publico.logica.ts`, onde ela é declarada e contada.
   */
  it("o telefone sai COMO FOI DIGITADO — a tabela é prova, não cadastro", () => {
    expect(
      montarPayloadDeConsentimento(formulario({ telefone: "(35) 99999-8888" })).telefone,
    ).toBe("(35) 99999-8888");
  });

  it("campos em branco viram null, e não string vazia", () => {
    const payload = montarPayloadDeConsentimento(
      formulario({ email: "  ", telefone: "" }),
    );
    expect(payload.email).toBeNull();
    expect(payload.telefone).toBeNull();
  });

  it("manda exatamente as cinco chaves que o POST lê", () => {
    expect(Object.keys(montarPayloadDeConsentimento(formulario())).sort()).toEqual([
      "canal",
      "email",
      "estado",
      "origem",
      "telefone",
    ]);
  });
});
