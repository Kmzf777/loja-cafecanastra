import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DISTINGUE_POR_PAPEL,
  PAPEIS,
  PAPEL_PADRAO,
  POR_PAGINA_NA_BUSCA,
  ROTA_DE_ADMINISTRADORES,
  candidatosAPromover,
  consultaDeCandidatos,
  ehUltimoAdmin,
  ehVoceMesmo,
  fraseDaRemocao,
  identificarAdmin,
  motivoParaNaoRemover,
  payloadDePromocao,
  rotuloDoPapel,
  textoOuTraco,
  vazioDaBusca,
  type AdministradorDaLista,
} from "./administradores.logica";

const RAIZ_DO_BACKEND = join(__dirname, "..", "..", "..", "..", "backend");

function admin(parcial: Partial<AdministradorDaLista> = {}): AdministradorDaLista {
  return {
    user_id: "dddddddd-0000-0000-0000-000000000001",
    papel: "dono",
    criado_em: "2026-01-10T12:00:00.000Z",
    nome: "Rafael",
    email: "rafael@cafecanastra.com",
    ...parcial,
  };
}

/* ========================================================================== */

describe("PAPEIS", () => {
  /**
   * O contrato com o backend, lido do disco — o mesmo que `status.test.ts`
   * mantém para pedidos. Um papel inventado aqui vira 400 na cara do gestor
   * ("Papel inválido. Use um de: …"); um papel novo lá vira uma opção que a
   * tela não oferece. Nenhuma das duas aparece em `tsc` nem em `next build`.
   */
  it("tem exatamente os valores de administradoresRepository.js", () => {
    const fonte = readFileSync(
      join(RAIZ_DO_BACKEND, "src", "repositories", "administradoresRepository.js"),
      "utf8",
    );
    const bloco = fonte.match(/PAPEIS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    expect(bloco).not.toBeNull();
    const doBackend = [...bloco![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

    expect(PAPEIS.map((p) => p.valor)).toEqual(doBackend);
  });

  it("o padrão da tela é o mesmo padrão do backend", () => {
    const fonte = readFileSync(
      join(RAIZ_DO_BACKEND, "src", "repositories", "administradoresRepository.js"),
      "utf8",
    );
    expect(fonte).toContain('papel = "dono"');
    expect(PAPEL_PADRAO).toBe("dono");
  });

  it("todo papel tem rótulo e descrição em português", () => {
    for (const p of PAPEIS) {
      expect(p.rotulo.length).toBeGreaterThan(0);
      expect(p.rotulo).not.toBe(p.valor);
      expect(p.descricao.length).toBeGreaterThan(0);
    }
  });
});

describe("rotuloDoPapel", () => {
  it("traduz os três conhecidos", () => {
    expect(rotuloDoPapel("dono")).toBe("Dono");
    expect(rotuloDoPapel("gerente")).toBe("Gerente");
    expect(rotuloDoPapel("operador")).toBe("Operador");
  });

  it("devolve o próprio valor para desconhecido, em vez de escondê-lo", () => {
    expect(rotuloDoPapel("financeiro")).toBe("financeiro");
  });
});

describe("DISTINGUE_POR_PAPEL — a afirmação conferida contra o servidor", () => {
  /**
   * A tela DIZ que o papel não limita nada hoje. Se `isAdmin` passar a olhar
   * `papel`, este teste fica vermelho e obriga a atualizar a frase — em vez de
   * deixá-la desatualizada dizendo o contrário do que o servidor faz. Um
   * seletor de papel sem essa frase é a pior espécie de mentira de interface: a
   * que o gestor só descobre quando o "operador" muda um preço.
   */
  it("isAdmin pergunta só por `ehAdmin`, e não pelo papel", () => {
    const fonte = readFileSync(
      join(RAIZ_DO_BACKEND, "src", "middleware", "isAdmin.js"),
      "utf8",
    );
    expect(fonte).toContain("req.user.ehAdmin === true");

    // Sem comentário, para a explicação da regra não ser confundida com a
    // regra — a mesma limpeza que `proibicoes.test.ts` faz.
    const semComentarios = fonte
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(?<!:)\/\/[^\n]*/g, "");
    expect(semComentarios).not.toContain("papel");

    expect(DISTINGUE_POR_PAPEL).toBe(false);
  });
});

/* ========================================================================== */

describe("identificarAdmin — R23", () => {
  it("usa o nome", () => {
    expect(identificarAdmin({ nome: "Ana Souza", email: "a@b.com" })).toBe("Ana Souza");
  });

  it("cai para o e-mail quando não há nome", () => {
    expect(identificarAdmin({ nome: null, email: "a@b.com" })).toBe("a@b.com");
    expect(identificarAdmin({ nome: "  ", email: "a@b.com" })).toBe("a@b.com");
  });

  it("sem nenhum dos dois, declara a ausência em vez de deixar a célula vazia", () => {
    expect(identificarAdmin({ nome: null, email: null })).toBe("Sem identificação");
  });

  /**
   * O gesto que esta tela existe para proteger é "clicar em remover", e ninguém
   * o faz certo cruzando uuid com pessoa na mão. O backend já faz o JOIN; a
   * tela só não pode desperdiçá-lo.
   */
  it("nunca devolve uuid", () => {
    const linha = admin({ nome: null, email: null });
    expect(identificarAdmin(linha)).not.toContain(linha.user_id);
  });
});

describe("textoOuTraco", () => {
  it("devolve o texto quando há, e travessão quando não", () => {
    expect(textoOuTraco("a@b.com")).toBe("a@b.com");
    expect(textoOuTraco("")).toBe("—");
    expect(textoOuTraco("   ")).toBe("—");
    expect(textoOuTraco(null)).toBe("—");
  });
});

/* ========================================================================== */

describe("ehUltimoAdmin — avisar ANTES de tentar", () => {
  it("é verdadeiro com um só, e com nenhum", () => {
    expect(ehUltimoAdmin([admin()])).toBe(true);
    expect(ehUltimoAdmin([])).toBe(true);
  });

  it("é falso a partir de dois", () => {
    expect(ehUltimoAdmin([admin(), admin({ user_id: "x" })])).toBe(false);
  });
});

describe("motivoParaNaoRemover", () => {
  it("com um só administrador, explica a regra e o que fazer antes", () => {
    const motivo = motivoParaNaoRemover([admin()])!;
    expect(motivo).toContain("única pessoa que administra a loja");
    expect(motivo).toContain("Promova outro administrador");
  });

  /**
   * O trigger `admins_nunca_zero` (0002:118) já impede no banco, e o
   * repositório traduz o 23001 numa frase decente. A tela avisa antes porque
   * quem clicou em "Remover" já decidiu remover: descobrir a regra pelo erro é
   * transformar uma informação de desenho num obstáculo.
   */
  it("a razão que a frase dá é a mesma que o trigger do banco impõe", () => {
    const migracao = readFileSync(
      join(RAIZ_DO_BACKEND, "db", "migrations", "0002_clientes_e_admins.sql"),
      "utf8",
    );
    expect(migracao).toContain("admins_nunca_zero");
    expect(motivoParaNaoRemover([admin()])).toContain("sem administrador");
  });

  it("com dois, é null — e aí a tela desenha o botão", () => {
    expect(motivoParaNaoRemover([admin(), admin({ user_id: "x" })])).toBeNull();
  });
});

describe("ehVoceMesmo", () => {
  it("compara uuid com uuid", () => {
    expect(ehVoceMesmo("abc", "abc")).toBe(true);
    expect(ehVoceMesmo("abc", "def")).toBe(false);
  });

  it("sessão sem uuid nunca é 'você' — dois indefinidos não se encontram", () => {
    expect(ehVoceMesmo("abc", null)).toBe(false);
    expect(ehVoceMesmo("abc", undefined)).toBe(false);
    expect(ehVoceMesmo("", null)).toBe(false);
    expect(ehVoceMesmo("", "")).toBe(false);
  });
});

describe("fraseDaRemocao — R11/R12", () => {
  it("nomeia a PESSOA, e não um 'este item'", () => {
    expect(fraseDaRemocao("Ana Souza", false).texto).toContain("Ana Souza");
  });

  /**
   * A confusão que custa caro: `DELETE /admin/administradores/:userId` tira o
   * PAPEL; `DELETE /auth/users/:id` apaga a CONTA. Sem dizer qual é qual, o
   * gestor hesita num gesto reversível — ou, pior, não hesita no irreversível.
   */
  it("diz que a conta de cliente CONTINUA — tirar o crachá não é demitir", () => {
    const { texto } = fraseDaRemocao("Ana", false);
    expect(texto).toContain("conta de cliente continua");
    expect(texto).toContain("promover de novo");
  });

  it("o botão nomeia o gesto, e não é um 'OK'", () => {
    expect(fraseDaRemocao("Ana", false).confirmar).toBe("Remover o acesso");
    expect(fraseDaRemocao("Ana", false).confirmar).not.toMatch(/^(OK|Sim|Confirmar)$/);
  });

  /**
   * Remover a si mesmo é permitido pelo backend quando há outro admin, e é a
   * porta de saída mais rápida do painel — a tela de administradores é a única
   * que promove, e depois de sair dela ninguém a alcança.
   */
  it("remover a si mesmo tem título, texto e botão PRÓPRIOS", () => {
    const eu = fraseDaRemocao("Rafael", true);
    const outro = fraseDaRemocao("Rafael", false);

    expect(eu.titulo).not.toBe(outro.titulo);
    expect(eu.texto).not.toBe(outro.texto);
    expect(eu.confirmar).not.toBe(outro.confirmar);

    expect(eu.texto).toContain("Você vai tirar de si mesmo");
    expect(eu.texto).toContain("só outro administrador pode devolver o acesso");
    expect(eu.confirmar).toContain("meu acesso");
  });
});

/* ========================================================================== */

describe("consultaDeCandidatos", () => {
  it("usa a mesma rota da tela de Clientes, com limite próprio", () => {
    expect(consultaDeCandidatos("ana")).toBe(
      `/auth/users?q=ana&limit=${POR_PAGINA_NA_BUSCA}`,
    );
  });

  it("busca vazia não vira parâmetro vazio", () => {
    expect(consultaDeCandidatos("   ")).toBe(`/auth/users?limit=${POR_PAGINA_NA_BUSCA}`);
  });

  it("escapa o que foi digitado — um e-mail tem '@' e um CPF tem ponto", () => {
    expect(consultaDeCandidatos("ana@casa.com")).toContain("q=ana%40casa.com");
  });

  it("o seletor de diálogo pede menos que uma lista de trabalho", () => {
    expect(POR_PAGINA_NA_BUSCA).toBeLessThan(20);
  });
});

describe("candidatosAPromover", () => {
  const clientes = [
    { user_id: "1", name: "Ana", email: "ana@x.com" },
    { user_id: "2", name: "Bia", email: "bia@x.com" },
    { user_id: "3", name: "Caio", email: "caio@x.com" },
  ];

  /**
   * O backend responde 409 "Esta pessoa já é administradora da loja." — uma boa
   * frase para uma pergunta que a tela não precisava fazer: ela TEM a lista de
   * admins em mãos.
   */
  it("tira quem já é administrador da lista de escolha", () => {
    const fora = candidatosAPromover(clientes, [{ user_id: "2" }]);
    expect(fora.map((c) => c.user_id)).toEqual(["1", "3"]);
  });

  it("sem admin nenhum na página, devolve todos", () => {
    expect(candidatosAPromover(clientes, [])).toHaveLength(3);
  });

  it("todos já admins devolve lista vazia", () => {
    const admins = clientes.map((c) => ({ user_id: c.user_id }));
    expect(candidatosAPromover(clientes, admins)).toEqual([]);
  });

  it("não altera a lista recebida", () => {
    const copia = [...clientes];
    candidatosAPromover(clientes, [{ user_id: "1" }]);
    expect(clientes).toEqual(copia);
  });
});

describe("vazioDaBusca — R16, três vazios distintos", () => {
  it("sem digitar nada, instrui o que procurar", () => {
    expect(vazioDaBusca("", false)).toContain("já tem conta na loja");
  });

  /**
   * A regra que o 404 do backend cobra ("Cliente não encontrado nesta loja.")
   * existe por segurança — a instância Supabase é compartilhada. Mas o gestor
   * não sabe disso, e "não encontrado" o deixa achando que a busca quebrou.
   * O vazio é onde a regra se explica, não o erro.
   */
  it("busca sem resultado EXPLICA a regra e diz o que fazer a seguir", () => {
    const frase = vazioDaBusca("joana", false);
    expect(frase).toContain("joana");
    expect(frase).toContain("Só dá para promover quem já é cliente");
    expect(frase).toContain("criar a conta");
  });

  it("todo mundo da busca já é admin tem frase própria", () => {
    expect(vazioDaBusca("ana", true)).toBe(
      "Quem casou com esta busca já administra a loja.",
    );
  });

  it("apara o texto na frase — a busca por espaços não vira '  '", () => {
    expect(vazioDaBusca("  ana  ", false)).toContain('"ana"');
  });
});

describe("payloadDePromocao", () => {
  it("manda userId em camelCase, que é o que a rota lê primeiro", () => {
    expect(payloadDePromocao("abc", "gerente")).toEqual({
      userId: "abc",
      papel: "gerente",
    });
  });

  it("não manda os dois nomes 'por garantia' — isso esconderia divergência", () => {
    expect(Object.keys(payloadDePromocao("abc", "dono"))).toEqual(["userId", "papel"]);
  });
});

describe("ROTA_DE_ADMINISTRADORES", () => {
  it("é a rota em português do App Router", () => {
    expect(ROTA_DE_ADMINISTRADORES).toBe("/dashboard/administradores");
  });
});
