import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FRASE_JANELA_INVERTIDA,
  FRASE_SEM_NOME,
  FRASE_UTM_COM_ESPACO,
  FRASE_UTM_LONGA,
  POR_PAGINA,
  ROTA_DE_MARKETING,
  chipsDasCampanhas,
  custoDaPaginaEmCentavos,
  custoEmCentavos,
  custoEmTexto,
  faseDaJanela,
  formularioAberto,
  formularioDe,
  formularioVazio,
  lerEstado,
  montarConsulta,
  montarPayload,
  paraCampoLocal,
  situacaoDaCampanha,
  temFiltro,
  urlDaTela,
  utmCanonica,
  utmEmTexto,
  validarCampanha,
  type Campanha,
  type EstadoDasCampanhas,
  type FormularioDeCampanha,
} from "./campanhas.logica";

function campanha(sobrescreve: Partial<Campanha> = {}): Campanha {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    nome: "Dia das Mães 2026",
    canal: "meta",
    utm_campaign: "dia-das-maes-2026",
    custo_centavos: 150_000,
    inicio_em: null,
    fim_em: null,
    ativa: true,
    criada_em: "2026-08-01T12:00:00.000Z",
    atualizada_em: "2026-08-01T12:00:00.000Z",
    ...sobrescreve,
  };
}

function estado(sobrescreve: Partial<EstadoDasCampanhas> = {}): EstadoDasCampanhas {
  return { busca: "", canal: "", ativa: "", pagina: 1, editar: "", ...sobrescreve };
}

function formulario(
  sobrescreve: Partial<FormularioDeCampanha> = {},
): FormularioDeCampanha {
  return {
    nome: "Dia das Mães 2026",
    canal: "meta",
    utm_campaign: "dia-das-maes-2026",
    custoEmReais: "1500,00",
    inicio_em: "",
    fim_em: "",
    ativa: true,
    ...sobrescreve,
  };
}

/* ========================================================================== *
 * As frases copiadas do backend
 * ========================================================================== */

/**
 * A TRAVA QUE AUTORIZA A CÓPIA.
 *
 * `campanhas.logica.ts` valida no navegador para a pessoa não esperar uma ida
 * ao servidor, e para isso repete quatro frases que nasceram em
 * `marketingRepository.js`. A repetição só é honesta enquanto as duas pontas
 * dizem a MESMA coisa — senão a mesma recusa passa a ter dois textos, e o
 * gestor que ligar para o suporte cita um que não existe no servidor.
 */
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

  it.each([
    ["UTM com espaço", FRASE_UTM_COM_ESPACO],
    ["UTM longa demais", FRASE_UTM_LONGA],
    ["campanha sem nome", FRASE_SEM_NOME],
    ["janela invertida", FRASE_JANELA_INVERTIDA],
  ])("a frase de %s existe literalmente no repositório do Express", (_, frase) => {
    expect(REPOSITORIO).toContain(frase);
  });
});

/* ========================================================================== *
 * lerEstado — a URL é a fonte, e ela não é confiável
 * ========================================================================== */

describe("lerEstado", () => {
  it("lê busca, canal, ativa e página da query", () => {
    expect(
      lerEstado({ q: " verao ", canal: "google", ativa: "true", pagina: "3" }),
    ).toEqual({
      busca: "verao",
      canal: "google",
      ativa: "true",
      pagina: 3,
      editar: "",
    });
  });

  it("nada na query é o estado vazio, na página 1", () => {
    expect(lerEstado({})).toEqual({
      busca: "",
      canal: "",
      ativa: "",
      pagina: 1,
      editar: "",
    });
  });

  /**
   * O caso que decide se a tela quebra com um link velho: a rota responde 400
   * com frase para canal inválido, e a tela inteira viraria uma tarja de erro
   * por causa de um parâmetro que ninguém digitou de propósito.
   */
  it("canal fora do vocabulário vira SEM FILTRO, e não vai para o backend", () => {
    expect(lerEstado({ canal: "tiktok" }).canal).toBe("");
    expect(montarConsulta(estado({ canal: "" }))).not.toContain("canal");
  });

  it("ativa só aceita os dois literais que o backend entende", () => {
    expect(lerEstado({ ativa: "true" }).ativa).toBe("true");
    expect(lerEstado({ ativa: "false" }).ativa).toBe("false");
    expect(lerEstado({ ativa: "sim" }).ativa).toBe("");
    expect(lerEstado({ ativa: "1" }).ativa).toBe("");
  });

  it("página zero, negativa ou não-numérica cai em 1", () => {
    expect(lerEstado({ pagina: "0" }).pagina).toBe(1);
    expect(lerEstado({ pagina: "-4" }).pagina).toBe(1);
    expect(lerEstado({ pagina: "abc" }).pagina).toBe(1);
  });

  it("parâmetro repetido na URL (array) não vira filtro", () => {
    expect(lerEstado({ q: ["a", "b"], canal: ["google", "meta"] })).toEqual({
      busca: "",
      canal: "",
      ativa: "",
      pagina: 1,
      editar: "",
    });
  });
});

/* ========================================================================== *
 * montarConsulta / urlDaTela
 * ========================================================================== */

describe("montarConsulta", () => {
  it("bate na rota do Express com o limite da tela", () => {
    expect(montarConsulta(estado())).toBe(
      `/admin/campanhas?page=1&limit=${POR_PAGINA}`,
    );
  });

  it("leva os três filtros quando existem", () => {
    const consulta = montarConsulta(
      estado({ busca: "verao", canal: "google", ativa: "false", pagina: 2 }),
    );
    expect(consulta).toContain("q=verao");
    expect(consulta).toContain("canal=google");
    expect(consulta).toContain("ativa=false");
    expect(consulta).toContain("page=2");
  });

  it("filtro vazio não vira parâmetro vazio", () => {
    expect(montarConsulta(estado())).not.toContain("q=");
    expect(montarConsulta(estado())).not.toContain("ativa=");
  });
});

describe("urlDaTela", () => {
  it("a página 1 não polui a URL", () => {
    expect(urlDaTela(estado())).toBe(ROTA_DE_MARKETING);
    expect(urlDaTela(estado({ pagina: 1 }))).toBe(ROTA_DE_MARKETING);
  });

  it("da página 2 em diante o número aparece — R2, o F5 devolve a mesma lista", () => {
    expect(urlDaTela(estado({ pagina: 2 }))).toBe(`${ROTA_DE_MARKETING}?pagina=2`);
  });

  it("virar a página carrega os filtros junto", () => {
    const url = urlDaTela(estado({ busca: "verao", canal: "meta", pagina: 3 }));
    expect(url).toContain("q=verao");
    expect(url).toContain("canal=meta");
    expect(url).toContain("pagina=3");
  });
});

/* ========================================================================== *
 * Os chips — R3
 * ========================================================================== */

describe("chipsDasCampanhas", () => {
  it("sem filtro, nenhum chip", () => {
    expect(chipsDasCampanhas(estado())).toEqual([]);
    expect(temFiltro(estado())).toBe(false);
  });

  it("o chip de canal mostra o RÓTULO, não o valor cru do banco", () => {
    const [chip] = chipsDasCampanhas(estado({ canal: "meta" }));
    expect(chip.dimensao).toBe("Canal");
    expect(chip.valor).toBe("Meta (Instagram/Facebook)");
  });

  it("o chip de situação traduz o booleano para palavra", () => {
    expect(chipsDasCampanhas(estado({ ativa: "true" }))[0].valor).toBe("Ligada");
    expect(chipsDasCampanhas(estado({ ativa: "false" }))[0].valor).toBe("Desligada");
  });

  it("o chip de busca mostra o que a pessoa escreveu, sem maquiar", () => {
    expect(chipsDasCampanhas(estado({ busca: "verao" }))[0].valor).toBe("verao");
  });

  /** Remover um chip não pode levar junto os outros — é o R3 pelo avesso. */
  it("remover um chip preserva as outras dimensões", () => {
    const chips = chipsDasCampanhas(
      estado({ busca: "verao", canal: "meta", ativa: "true" }),
    );
    const doCanal = chips.find((c) => c.chave === "canal")!;
    expect(doCanal.href).toContain("q=verao");
    expect(doCanal.href).toContain("ativa=true");
    expect(doCanal.href).not.toContain("canal=");
  });

  /**
   * Quem está na página 4 e remove um filtro cairia numa página 4 que já não
   * existe — e leria "nenhum resultado" logo depois de LIMPAR um filtro.
   */
  it("remover um chip volta para a página 1", () => {
    const [chip] = chipsDasCampanhas(estado({ busca: "verao", pagina: 4 }));
    expect(chip.href).not.toContain("pagina=");
  });

  it("três filtros, três chips", () => {
    expect(
      chipsDasCampanhas(estado({ busca: "v", canal: "meta", ativa: "true" })),
    ).toHaveLength(3);
    expect(temFiltro(estado({ ativa: "false" }))).toBe(true);
  });
});

/* ========================================================================== *
 * O formulário na URL — R2
 * ========================================================================== */

describe("o formulário vive na URL", () => {
  /**
   * Com o formulário na URL, o F5 no meio do preenchimento devolve o formulário
   * aberto, o "voltar" do navegador o fecha em vez de sair da tela, e um link
   * colado abre a campanha certa. Um `useState` perde as três.
   */
  it("«novo» e um id viajam na URL", () => {
    expect(urlDaTela(estado({ editar: "novo" }))).toContain("editar=novo");
    expect(urlDaTela(estado({ editar: "abc-123" }))).toContain("editar=abc-123");
  });

  it("sem formulário aberto, nada aparece na URL", () => {
    expect(urlDaTela(estado())).toBe(ROTA_DE_MARKETING);
  });

  it("abrir o formulário preserva o filtro e a página", () => {
    const url = urlDaTela(estado({ busca: "verao", pagina: 3, editar: "abc" }));
    expect(url).toContain("q=verao");
    expect(url).toContain("pagina=3");
    expect(url).toContain("editar=abc");
  });

  it("o formulário aberto NÃO é um filtro — não vira chip nem conta em temFiltro", () => {
    expect(chipsDasCampanhas(estado({ editar: "abc" }))).toEqual([]);
    expect(temFiltro(estado({ editar: "abc" }))).toBe(false);
  });

  /**
   * A campanha em edição está na página ATUAL, e mudar o filtro refaz a página.
   * Carregar `editar` adiante abriria a tela num estado "perdido" logo depois
   * de a pessoa clicar num chip, sem relação aparente com o que ela fez.
   */
  it("remover um filtro FECHA o formulário", () => {
    const [chip] = chipsDasCampanhas(estado({ busca: "verao", editar: "abc" }));
    expect(chip.href).not.toContain("editar");
  });
});

describe("formularioAberto", () => {
  const linhas = [campanha({ id: "a-1" }), campanha({ id: "a-2" })];

  it("sem parâmetro, fechado", () => {
    expect(formularioAberto(estado(), linhas)).toEqual({
      aberto: false,
      campanha: null,
      perdida: false,
    });
  });

  it("«novo» abre o formulário de criação, sem campanha", () => {
    expect(formularioAberto(estado({ editar: "novo" }), linhas)).toEqual({
      aberto: true,
      campanha: null,
      perdida: false,
    });
  });

  it("um id da página abre aquela campanha", () => {
    const r = formularioAberto(estado({ editar: "a-2" }), linhas);
    expect(r.aberto).toBe(true);
    expect(r.campanha?.id).toBe("a-2");
    expect(r.perdida).toBe(false);
  });

  /**
   * NÃO HÁ `GET /admin/campanhas/:id` NO EXPRESS. Um id de outra página não tem
   * como ser resolvido — e abrir o formulário VAZIO ali seria pior que não
   * abrir: a pessoa preencheria achando que edita e CRIARIA uma campanha nova.
   */
  it("um id fora da página não abre formulário vazio: marca «perdida»", () => {
    const r = formularioAberto(estado({ editar: "de-outra-pagina" }), linhas);
    expect(r.aberto).toBe(false);
    expect(r.campanha).toBeNull();
    expect(r.perdida).toBe(true);
  });
});

/* ========================================================================== *
 * A janela derivada
 * ========================================================================== */

describe("faseDaJanela", () => {
  const AGORA = new Date("2026-08-26T15:00:00.000Z");

  it("as duas datas nulas são «sem janela» — vale sempre", () => {
    expect(faseDaJanela({ inicio_em: null, fim_em: null }, AGORA)).toBe("sem_janela");
  });

  it("início no futuro é «agendada»", () => {
    expect(
      faseDaJanela({ inicio_em: "2026-09-01T00:00:00.000Z", fim_em: null }, AGORA),
    ).toBe("agendada");
  });

  it("fim no passado é «encerrada»", () => {
    expect(
      faseDaJanela({ inicio_em: null, fim_em: "2026-08-01T00:00:00.000Z" }, AGORA),
    ).toBe("encerrada");
  });

  it("entre as duas é «vigente»", () => {
    expect(
      faseDaJanela(
        { inicio_em: "2026-08-01T00:00:00.000Z", fim_em: "2026-09-01T00:00:00.000Z" },
        AGORA,
      ),
    ).toBe("vigente");
  });

  it("só início, já começado, é «vigente» — sem fim é sem prazo", () => {
    expect(
      faseDaJanela({ inicio_em: "2026-08-01T00:00:00.000Z", fim_em: null }, AGORA),
    ).toBe("vigente");
  });

  it("data ilegível é tratada como ausente, e não derruba a linha", () => {
    expect(faseDaJanela({ inicio_em: "não é data", fim_em: null }, AGORA)).toBe(
      "sem_janela",
    );
  });
});

describe("situacaoDaCampanha", () => {
  const AGORA = new Date("2026-08-26T15:00:00.000Z");

  /**
   * O caso que a tela existe para nomear: o gestor acha que está anunciando e
   * não está. Só `ativa` diria "Ligada"; só a janela diria "Encerrada"; a
   * junção diz "Encerrada" COM alerta e com o que fazer.
   */
  it("ligada e fora da janela é ALERTA, e a frase diz o que fazer", () => {
    const s = situacaoDaCampanha(
      { ativa: true, inicio_em: null, fim_em: "2026-08-01T00:00:00.000Z" },
      AGORA,
    );
    expect(s.rotulo).toBe("Encerrada");
    expect(s.tom).toBe("alerta");
    expect(s.explicacao).toMatch(/data de fim|desligue/);
  });

  it("ligada e agendada também é alerta — nada é atribuído a ela ainda", () => {
    const s = situacaoDaCampanha(
      { ativa: true, inicio_em: "2026-09-01T00:00:00.000Z", fim_em: null },
      AGORA,
    );
    expect(s.rotulo).toBe("Agendada");
    expect(s.tom).toBe("alerta");
  });

  /**
   * Desligada é desligada, e a janela não muda isso. Sem esta guarda a tela
   * mostraria "Vigente" numa campanha que a pessoa acabou de desligar.
   */
  it("desligada ignora a janela — nenhuma data a torna vigente", () => {
    for (const janela of [
      { inicio_em: null, fim_em: null },
      { inicio_em: "2026-08-01T00:00:00.000Z", fim_em: "2026-09-01T00:00:00.000Z" },
      { inicio_em: "2026-09-01T00:00:00.000Z", fim_em: null },
    ]) {
      const s = situacaoDaCampanha({ ativa: false, ...janela }, AGORA);
      expect(s.rotulo).toBe("Desligada");
      expect(s.tom).toBe("neutro");
    }
  });

  /**
   * A ARMADILHA INVERTIDA DO MODELO LEGADO: lá, promoção `ativa` sem datas
   * NUNCA valia. Aqui vale sempre — e a frase tem de dizer isso, porque quem
   * administrava o painel antigo aprendeu a regra contrária.
   */
  it("ligada e sem datas é sucesso, e a frase desfaz a regra do painel antigo", () => {
    const s = situacaoDaCampanha(
      { ativa: true, inicio_em: null, fim_em: null },
      AGORA,
    );
    expect(s.rotulo).toBe("Sem janela");
    expect(s.tom).toBe("sucesso");
    expect(s.explicacao).toMatch(/vale sempre/);
  });

  it("ligada e dentro da janela é sucesso, sem cerimônia", () => {
    const s = situacaoDaCampanha(
      {
        ativa: true,
        inicio_em: "2026-08-01T00:00:00.000Z",
        fim_em: "2026-09-01T00:00:00.000Z",
      },
      AGORA,
    );
    expect(s.rotulo).toBe("Vigente");
    expect(s.tom).toBe("sucesso");
  });

  it("toda situação tem explicação em texto — cor sozinha não informa", () => {
    for (const ativa of [true, false]) {
      for (const janela of [
        { inicio_em: null, fim_em: null },
        { inicio_em: "2026-09-01T00:00:00.000Z", fim_em: null },
        { inicio_em: null, fim_em: "2026-08-01T00:00:00.000Z" },
        { inicio_em: "2026-08-01T00:00:00.000Z", fim_em: "2026-09-01T00:00:00.000Z" },
      ]) {
        const s = situacaoDaCampanha({ ativa, ...janela }, AGORA);
        expect(s.explicacao.length).toBeGreaterThan(20);
      }
    }
  });
});

/* ========================================================================== *
 * O formulário
 * ========================================================================== */

describe("formularioVazio", () => {
  it("nasce SEM canal — pré-selecionar faria a campanha errar por distração", () => {
    expect(formularioVazio().canal).toBe("");
  });

  it("nasce ligada: quem cadastra uma campanha está começando a rodá-la", () => {
    expect(formularioVazio().ativa).toBe(true);
  });
});

describe("formularioDe", () => {
  it("centavos viram reais COM VÍRGULA, que é como se lê dinheiro em pt-BR", () => {
    expect(formularioDe(campanha({ custo_centavos: 150_000 })).custoEmReais).toBe(
      "1500,00",
    );
    expect(formularioDe(campanha({ custo_centavos: 599 })).custoEmReais).toBe("5,99");
    expect(formularioDe(campanha({ custo_centavos: 0 })).custoEmReais).toBe("0,00");
  });

  it("UTM nula vira campo vazio, e não a string «null»", () => {
    expect(formularioDe(campanha({ utm_campaign: null })).utm_campaign).toBe("");
  });

  it("ida e volta preserva o que o gestor vê", () => {
    const original = campanha({ custo_centavos: 12_345 });
    const payload = montarPayload(formularioDe(original));
    expect(payload.custo_centavos).toBe(12_345);
    expect(payload.nome).toBe(original.nome);
    expect(payload.utm_campaign).toBe(original.utm_campaign);
  });
});

describe("paraCampoLocal — R31, o corte é em São Paulo", () => {
  /**
   * O ATALHO ERRADO É `toISOString().slice(0,16)`, e ele erra por três horas.
   * 21h de 25/08 em Brasília é `2026-08-26T00:00Z`: o campo abriria em 26/08
   * 00:00, o gestor salvaria de volta, e a campanha andaria um dia para a
   * frente a CADA edição — sem erro nenhum e sem ninguém desconfiar.
   */
  it("21h de 25/08 em São Paulo não vira 26/08 no campo", () => {
    expect(paraCampoLocal("2026-08-26T00:00:00.000Z")).toBe("2026-08-25T21:00");
  });

  it("meia-noite de São Paulo é 00:00, e nunca 24:00", () => {
    expect(paraCampoLocal("2026-08-26T03:00:00.000Z")).toBe("2026-08-26T00:00");
  });

  it("nulo e ilegível viram campo vazio", () => {
    expect(paraCampoLocal(null)).toBe("");
    expect(paraCampoLocal("não é data")).toBe("");
  });
});

describe("utmCanonica", () => {
  it("maiúscula é normalizada — «Verao» e «verao» são a MESMA campanha", () => {
    expect(utmCanonica("Verao-2026")).toEqual({ valor: "verao-2026", erro: null });
  });

  /**
   * A assimetria é do backend e é deliberada: minúscula é conversão sem perda;
   * escolher entre "dia das maes" e "dia-das-maes" mudaria a chave que o
   * anúncio já usa lá fora.
   */
  it("espaço é RECUSADO, não normalizado", () => {
    expect(utmCanonica("dia das maes").erro).toBe(FRASE_UTM_COM_ESPACO);
    expect(utmCanonica("dia das maes").valor).toBeNull();
  });

  it("tabulação e quebra de linha contam como espaço", () => {
    expect(utmCanonica("a\tb").erro).toBe(FRASE_UTM_COM_ESPACO);
  });

  it("acima de 120 caracteres é recusada — é o limite do CHECK de 0033", () => {
    expect(utmCanonica("a".repeat(120)).erro).toBeNull();
    expect(utmCanonica("a".repeat(121)).erro).toBe(FRASE_UTM_LONGA);
  });

  /** UTM ausente NÃO é defeito: o índice é parcial de propósito, para o
   *  panfleto e o influenciador sem link rastreado conviverem. */
  it("vazia é null sem erro — campanha sem link rastreado existe", () => {
    expect(utmCanonica("")).toEqual({ valor: null, erro: null });
    expect(utmCanonica("   ")).toEqual({ valor: null, erro: null });
  });
});

describe("custoEmCentavos", () => {
  it("vírgula e ponto valem o mesmo", () => {
    expect(custoEmCentavos("1500,00")).toBe(150_000);
    expect(custoEmCentavos("1500.00")).toBe(150_000);
  });

  /** Campanha sem custo existe (panfleto, post orgânico, influenciador que não
   *  cobrou). Exigir "0" seria um campo obrigatório que se preenche sem ler. */
  it("vazio é ZERO, e não erro", () => {
    expect(custoEmCentavos("")).toBe(0);
    expect(custoEmCentavos("   ")).toBe(0);
  });

  it("negativo é recusado — o CHECK campanhas_custo_nao_negativo", () => {
    expect(custoEmCentavos("-10")).toBeNull();
  });

  it("texto que não é número é recusado", () => {
    expect(custoEmCentavos("mil e quinhentos")).toBeNull();
  });

  it("arredonda o centavo em vez de truncar", () => {
    expect(custoEmCentavos("0,015")).toBe(2);
    expect(custoEmCentavos("19,99")).toBe(1999);
  });
});

describe("validarCampanha", () => {
  it("o formulário completo não tem erro nenhum", () => {
    expect(validarCampanha(formulario())).toEqual({});
  });

  it("nome em branco usa a frase do servidor", () => {
    expect(validarCampanha(formulario({ nome: "   " })).nome).toBe(FRASE_SEM_NOME);
  });

  it("canal ausente ou fora do vocabulário pede a escolha", () => {
    expect(validarCampanha(formulario({ canal: "" })).canal).toBeTruthy();
    expect(validarCampanha(formulario({ canal: "tiktok" })).canal).toBeTruthy();
  });

  it("a UTM com espaço reprova com a frase do servidor", () => {
    expect(validarCampanha(formulario({ utm_campaign: "a b" })).utm_campaign).toBe(
      FRASE_UTM_COM_ESPACO,
    );
  });

  /**
   * A janela é conferida ANTES de ir ao servidor porque o CHECK
   * `campanhas_janela_coerente` responderia 23514 — e o repositório traduz, mas
   * só depois de uma ida e volta com o formulário inteiro.
   */
  it("fim antes ou igual ao início reprova com a frase do servidor", () => {
    expect(
      validarCampanha(
        formulario({ inicio_em: "2026-09-01T10:00", fim_em: "2026-08-01T10:00" }),
      ).fim_em,
    ).toBe(FRASE_JANELA_INVERTIDA);

    expect(
      validarCampanha(
        formulario({ inicio_em: "2026-09-01T10:00", fim_em: "2026-09-01T10:00" }),
      ).fim_em,
    ).toBe(FRASE_JANELA_INVERTIDA);
  });

  it("uma data só nunca é janela invertida", () => {
    expect(validarCampanha(formulario({ inicio_em: "2026-09-01T10:00" }))).toEqual({});
    expect(validarCampanha(formulario({ fim_em: "2026-09-01T10:00" }))).toEqual({});
  });

  it("custo ilegível reprova, e a frase diz que zero é uma resposta válida", () => {
    expect(validarCampanha(formulario({ custoEmReais: "abc" })).custoEmReais).toMatch(
      /0 se não houve gasto/,
    );
  });
});

describe("montarPayload", () => {
  it("manda exatamente os sete campos que o POST lê", () => {
    expect(Object.keys(montarPayload(formulario())).sort()).toEqual([
      "ativa",
      "canal",
      "custo_centavos",
      "fim_em",
      "inicio_em",
      "nome",
      "utm_campaign",
    ]);
  });

  it("datas em branco viram NULL, e não string vazia", () => {
    const payload = montarPayload(formulario({ inicio_em: "", fim_em: "  " }));
    expect(payload.inicio_em).toBeNull();
    expect(payload.fim_em).toBeNull();
  });

  it("a UTM sai já em minúscula — é a CHAVE de junção com pedidos", () => {
    expect(montarPayload(formulario({ utm_campaign: "VERAO" })).utm_campaign).toBe(
      "verao",
    );
  });

  it("o nome vai aparado", () => {
    expect(montarPayload(formulario({ nome: "  Verão  " })).nome).toBe("Verão");
  });

  it("o custo sai em CENTAVOS, que é a unidade da coluna", () => {
    expect(montarPayload(formulario({ custoEmReais: "1500,00" })).custo_centavos).toBe(
      150_000,
    );
  });
});

/* ========================================================================== *
 * O que a tabela mostra
 * ========================================================================== */

describe("utmEmTexto", () => {
  it("sem UTM não é defeito, e o texto não sugere que seja", () => {
    expect(utmEmTexto(campanha({ utm_campaign: null }))).toBe("Sem UTM");
  });

  it("com UTM mostra a UTM crua — é ela que casa com pedidos.utm_campaign", () => {
    expect(utmEmTexto(campanha({ utm_campaign: "verao-2026" }))).toBe("verao-2026");
  });
});

describe("custoEmTexto", () => {
  it("formata CENTAVOS, e não reais — a coluna é custo_centavos", () => {
    expect(custoEmTexto(campanha({ custo_centavos: 150_000 }))).toContain("1.500,00");
  });

  it("zero é zero, e não travessão: «não gastei» é uma informação", () => {
    expect(custoEmTexto(campanha({ custo_centavos: 0 }))).toContain("0,00");
  });
});

describe("custoDaPaginaEmCentavos", () => {
  it("soma o que está na página, e o nome não deixa confundir com o total", () => {
    expect(
      custoDaPaginaEmCentavos([
        campanha({ custo_centavos: 1000 }),
        campanha({ custo_centavos: 2500 }),
      ]),
    ).toBe(3500);
  });

  it("página vazia soma zero", () => {
    expect(custoDaPaginaEmCentavos([])).toBe(0);
  });
});
