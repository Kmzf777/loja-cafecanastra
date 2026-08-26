import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  POR_PAGINA,
  ROTA_DE_CLIENTES,
  chipsDosClientes,
  estadoCorrigido,
  identificarCliente,
  lerEstado,
  montarConsulta,
  normalizarBusca,
  temFiltro,
  textoOuTraco,
  urlDaTela,
  type ClienteDaLista,
} from "./clientes.logica";

const CLIENTE: ClienteDaLista = {
  user_id: "11111111-1111-1111-1111-111111111111",
  name: "Maria Souza",
  email: "maria@exemplo.com",
  phone: "(35) 99999-0000",
  purchases: 3,
};

/**
 * A busca por CPF é o caso caro desta tela, e é onde os testes se concentram.
 *
 * O defeito não dá erro nenhum: a URL fica bonita, a API responde 200, a tela
 * desenha "nenhum cliente para este filtro" — e o gestor conclui que a pessoa
 * que está no telefone com ele nunca comprou na loja.
 */
describe("normalizarBusca — o CPF pontuado que não acha ninguém", () => {
  /**
   * `529.982.247-25` é um CPF VÁLIDO (o mesmo que `lib/clube.test.ts` usa).
   * `canastra.clientes.cpf` guarda "52998224725", e o backend compara com
   * `ILIKE '%q%'` — texto contra texto.
   */
  it("CPF pontuado vira só os dígitos", () => {
    expect(normalizarBusca("529.982.247-25")).toBe("52998224725");
  });

  it("CPF com espaços também", () => {
    expect(normalizarBusca("  529 982 247 25  ")).toBe("52998224725");
  });

  it("CPF já em dígitos passa igual", () => {
    expect(normalizarBusca("52998224725")).toBe("52998224725");
  });

  /**
   * A ARMADILHA DA NORMALIZAÇÃO INGÊNUA: tirar toda pontuação de toda busca
   * conserta o CPF e quebra o e-mail, que é a busca MAIS usada desta tela.
   */
  it("e-mail sai INTACTO — tirar pontuação dele quebraria a busca mais usada", () => {
    expect(normalizarBusca("maria@exemplo.com")).toBe("maria@exemplo.com");
    expect(normalizarBusca("maria.souza@exemplo.com.br")).toBe(
      "maria.souza@exemplo.com.br",
    );
  });

  it("nome sai intacto", () => {
    expect(normalizarBusca("Maria Souza")).toBe("Maria Souza");
    expect(normalizarBusca("D'Ávila")).toBe("D'Ávila");
  });

  /**
   * O CASO DIFÍCIL: um celular brasileiro TAMBÉM tem onze dígitos. Se a regra
   * fosse só "onze dígitos", "35 99999-0000" viraria "35999990000" — e como
   * `clientes.telefone` é dado herdado, de formato desconhecido e sem nenhum
   * caminho de escrita no backend atual, a normalização estaria chutando o
   * formato do banco. Os dígitos verificadores da Receita é que separam os dois.
   */
  it("celular de onze dígitos NÃO é tratado como CPF", () => {
    expect(normalizarBusca("(35) 99999-0000")).toBe("(35) 99999-0000");
    expect(normalizarBusca("35 99999-0000")).toBe("35 99999-0000");
    expect(normalizarBusca("35999990000")).toBe("35999990000");
  });

  it("onze dígitos que não passam na conta da Receita ficam como estão", () => {
    // 11111111111 tem forma de CPF e é recusado pelo `validarCpf` (repetidos).
    expect(normalizarBusca("111.111.111-11")).toBe("111.111.111-11");
  });

  it("pedaço de CPF não vira nada — dez dígitos não é CPF", () => {
    expect(normalizarBusca("529.982.247")).toBe("529.982.247");
  });

  it("CNPJ pontuado passa igual — a busca não olha CNPJ, e mexer seria chutar", () => {
    expect(normalizarBusca("12.345.678/0001-90")).toBe("12.345.678/0001-90");
  });

  it.each(["", "   ", "\t\n"])("busca em branco (%j) é vazio", (bruto) => {
    expect(normalizarBusca(bruto)).toBe("");
  });
});

describe("lerEstado — o que veio da URL", () => {
  it("lê busca e página", () => {
    expect(lerEstado({ q: "maria", pagina: "3" })).toEqual({
      busca: "maria",
      pagina: 3,
    });
  });

  it("URL limpa é a página 1 sem busca", () => {
    expect(lerEstado({})).toEqual({ busca: "", pagina: 1 });
  });

  it("apara a busca — '?q=%20%20' é uma busca por dois espaços", () => {
    expect(lerEstado({ q: "  maria  " }).busca).toBe("maria");
    expect(lerEstado({ q: "   " }).busca).toBe("");
  });

  /** `?q=a&q=b`: `searchParams` entrega os dois, e escolher em silêncio faria
   *  a tela mostrar um filtro diferente do que está na barra de endereço. */
  it("parâmetro repetido cai no padrão em vez de escolher um", () => {
    expect(lerEstado({ q: ["a", "b"] }).busca).toBe("");
    expect(lerEstado({ pagina: ["2", "5"] }).pagina).toBe(1);
  });

  it.each(["0", "-3", "abc", ""])("página inválida (%j) é a 1", (bruto) => {
    expect(lerEstado({ pagina: bruto }).pagina).toBe(1);
  });
});

describe("montarConsulta — o que vai para GET /auth/users", () => {
  it("leva página e limite SEMPRE, e o limite é o da tela", () => {
    expect(montarConsulta({ busca: "", pagina: 1 })).toBe(
      `/auth/users?page=1&limit=${POR_PAGINA}`,
    );
  });

  /**
   * O padrão de `limit` no backend é 10. Uma tela que pagina de 20 em 20 e
   * omite o `limit` mostraria 10 linhas com um rodapé dizendo "1–20 de 134" —
   * o rodapé discordando da tabela na mesma tela.
   */
  it("o limite é explícito, e é o mesmo do rodapé", () => {
    expect(montarConsulta({ busca: "", pagina: 1 })).toContain(`limit=${POR_PAGINA}`);
  });

  it("a busca vai NORMALIZADA — é aqui que o CPF perde os pontos", () => {
    expect(montarConsulta({ busca: "529.982.247-25", pagina: 1 })).toContain(
      "q=52998224725",
    );
    expect(montarConsulta({ busca: "529.982.247-25", pagina: 1 })).not.toContain(".");
  });

  it("busca vazia não vira 'q=' — parâmetro vazio é um filtro que não existe", () => {
    expect(montarConsulta({ busca: "  ", pagina: 2 })).toBe(
      `/auth/users?page=2&limit=${POR_PAGINA}`,
    );
  });

  it("escapa o que precisa ser escapado", () => {
    expect(montarConsulta({ busca: "café & cia", pagina: 1 })).toContain(
      "q=caf%C3%A9+%26+cia",
    );
  });
});

describe("urlDaTela — a aba salva do R2", () => {
  it("sem estado, é a rota limpa", () => {
    expect(urlDaTela({})).toBe(ROTA_DE_CLIENTES);
  });

  /**
   * `?pagina=1` É OMITIDA. Duas URLs para a mesma tela são duas entradas no
   * histórico e dois favoritos que ninguém sabe distinguir — e o botão Voltar
   * passa a exigir dois cliques para sair de onde um bastava.
   */
  it("a página 1 não aparece na URL", () => {
    expect(urlDaTela({ busca: "maria", pagina: 1 })).toBe(
      `${ROTA_DE_CLIENTES}?q=maria`,
    );
  });

  it("a página 2 aparece, junto com a busca — as duas sobrevivem ao F5", () => {
    expect(urlDaTela({ busca: "maria", pagina: 2 })).toBe(
      `${ROTA_DE_CLIENTES}?q=maria&pagina=2`,
    );
  });

  /**
   * A URL DA TELA LEVA O TEXTO DIGITADO, não o normalizado: o chip de filtro
   * mostra o que a pessoa escreveu, e é assim que ela reconhece o que está
   * removendo. A normalização é só para a API.
   */
  it("a URL guarda o CPF como a pessoa digitou", () => {
    expect(urlDaTela({ busca: "529.982.247-25" })).toContain(
      "q=529.982.247-25".replace(/\./g, "."),
    );
    expect(decodeURIComponent(urlDaTela({ busca: "529.982.247-25" }))).toContain(
      "529.982.247-25",
    );
  });

  /**
   * A RESSALVA DO R2, VIRADA EM TESTE: nada de dado do RESULTADO na query
   * string — nem CPF, nem e-mail, nem endereço.
   *
   * A guarda é sobre o CONJUNTO DE NOMES que estas duas funções conseguem
   * emitir, e não sobre os valores. Valor é o que a pessoa digitou (e pode
   * conter qualquer coisa, inclusive um CPF que ela colou — isso é R2, é a
   * busca, e é o que faz a aba ser salvável). O que não pode nascer é um
   * parâmetro NOVO carregando dado de cliente: `?email=maria@…` vazaria para o
   * histórico, para o `Referer` e para a captura de tela do grupo do WhatsApp,
   * sem ninguém ter digitado nada.
   *
   * Escrito como lista fechada de propósito: um `?cpf=` acrescentado aqui um dia
   * fica vermelho, e quem o acrescentar tem de olhar para esta lista uma vez.
   */
  it("as duas funções só emitem os parâmetros da lista fechada — R2", () => {
    const nomes = (url: string) => [...new URLSearchParams(url.split("?")[1] ?? "").keys()];

    const daTela = nomes(
      urlDaTela({ busca: "maria@exemplo.com", pagina: 4 }),
    );
    expect(daTela.sort()).toEqual(["pagina", "q"]);

    const daApi = nomes(montarConsulta({ busca: "maria@exemplo.com", pagina: 4 }));
    expect(daApi.sort()).toEqual(["limit", "page", "q"]);
  });

  /**
   * E a metade estrutural: nenhuma CHAVE de URL neste módulo se chama cpf,
   * email ou endereço. Só olha as chamadas de `montarUrl`, porque o tipo
   * `ClienteDaLista` legitimamente tem um campo `email` — ele descreve o que a
   * API devolve, e o teste não pode confundir "usa" com "fala sobre", que é a
   * mesma disciplina do `proibicoes.test.ts`.
   */
  it("nenhuma chave de URL se chama cpf, email ou endereço", () => {
    const fonte = readFileSync(join(__dirname, "clientes.logica.ts"), "utf8");
    const chamadas = [...fonte.matchAll(/montarUrl\(([\s\S]*?)\n  \}\);/g)];
    expect(chamadas.length).toBeGreaterThanOrEqual(2);
    for (const [trecho] of chamadas) {
      expect(trecho).not.toMatch(/\b(?:cpf|email|e_mail|endereco|telefone)\s*:/i);
    }
  });
});

describe("estadoCorrigido — o favorito velho", () => {
  it("prende na última página que existe", () => {
    expect(estadoCorrigido({ busca: "", pagina: 9 }, 25).pagina).toBe(2);
  });

  it("não mexe numa página que existe", () => {
    expect(estadoCorrigido({ busca: "", pagina: 2 }, 100).pagina).toBe(2);
  });

  /**
   * ZERO RESULTADOS CONTINUA SENDO A PÁGINA 1, e não a página 0: é a página 1,
   * vazia. Página 0 faria o rodapé dizer "Página 0 de 0".
   */
  it("lista vazia é a página 1", () => {
    expect(estadoCorrigido({ busca: "zzz", pagina: 4 }, 0).pagina).toBe(1);
  });

  it("preserva a busca — corrigir a página não pode apagar o filtro", () => {
    expect(estadoCorrigido({ busca: "maria", pagina: 9 }, 5).busca).toBe("maria");
  });
});

describe("chipsDosClientes — R3", () => {
  it("sem busca, não há chip", () => {
    expect(chipsDosClientes({ busca: "", pagina: 1 })).toEqual([]);
  });

  it("com busca, há um chip que mostra o que foi digitado", () => {
    const [chip] = chipsDosClientes({ busca: "529.982.247-25", pagina: 3 });
    expect(chip.dimensao).toBe("Busca");
    expect(chip.valor).toBe("529.982.247-25");
  });

  /**
   * REMOVER O FILTRO ZERA A PÁGINA. Tirar a busca estando na página 4 e
   * continuar na 4 é o jeito mais rápido de fazer uma lista SEM filtro parecer
   * vazia — e o R3 existe justamente para o filtro nunca ser lido como "sumiu
   * meu cadastro".
   */
  it("o href de remoção volta para a lista inteira, na página 1", () => {
    const [chip] = chipsDosClientes({ busca: "maria", pagina: 4 });
    expect(chip.href).toBe(ROTA_DE_CLIENTES);
  });
});

describe("temFiltro — qual dos três estados vazios do R16 mostrar", () => {
  it("sem busca, não há filtro", () => {
    expect(temFiltro({ busca: "", pagina: 1 })).toBe(false);
  });
  it("com busca, há", () => {
    expect(temFiltro({ busca: "maria", pagina: 1 })).toBe(true);
  });
  it("a página NÃO é filtro — estar na 3 não muda o texto do vazio", () => {
    expect(temFiltro({ busca: "", pagina: 3 })).toBe(false);
  });
});

describe("identificarCliente — R23, a primeira coluna é gente", () => {
  it("o nome, quando há", () => {
    expect(identificarCliente(CLIENTE)).toBe("Maria Souza");
  });

  /**
   * Conta criada pelo e-mail e cadastro nunca completado é o caso normal, não a
   * exceção — e para essa pessoa o e-mail É o identificador humano.
   */
  it("o e-mail, quando não há nome", () => {
    expect(identificarCliente({ ...CLIENTE, name: null })).toBe("maria@exemplo.com");
    expect(identificarCliente({ ...CLIENTE, name: "   " })).toBe("maria@exemplo.com");
  });

  /**
   * NUNCA O UUID. Uma célula com `11111111-1111-…` não identifica ninguém e
   * ainda põe a chave interna na tela; uma célula VAZIA parece defeito de
   * carregamento. "Sem identificação" é o fato.
   */
  it("nem nome nem e-mail vira texto, nunca o UUID nem vazio", () => {
    const anonimo = identificarCliente({ ...CLIENTE, name: null, email: null });
    expect(anonimo).toBe("Sem identificação");
    expect(anonimo).not.toContain("1111");
  });
});

describe("textoOuTraco", () => {
  it("devolve o texto", () => {
    expect(textoOuTraco("maria@exemplo.com")).toBe("maria@exemplo.com");
  });

  /**
   * `LEFT JOIN auth.users` deixa `email` NULL para quem já não tem conta no
   * GoTrue. `null` renderizado é célula vazia — indistinguível de erro de
   * carregamento numa tabela densa.
   */
  it.each([null, undefined, "", "   "])("ausência (%j) é travessão", (valor) => {
    expect(textoOuTraco(valor)).toBe("—");
  });
});
