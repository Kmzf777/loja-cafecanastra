import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * O que estes testes protegem:
 *
 *   - A FORMA DA CHAMADA à RPC. `garantir_cliente` tem três parâmetros com
 *     DEFAULT NULL; mandar chave a mais, chave com nome errado ou `null`
 *     explícito muda o que o Postgres recebe, e o erro não aparece aqui — ele
 *     aparece como um cadastro sem telefone, ou como 23505 num CPF que ninguém
 *     digitou.
 *   - A RAMIFICAÇÃO POR `error.code`. 42501 e 28000 chegam os DOIS como HTTP
 *     403 e levam a telas diferentes (login × reenviar confirmação). Confundir
 *     os dois prende a pessoa num laço: a tela pede confirmação de um link que
 *     ela já clicou, ou manda para o login quem já está logado.
 *   - O CASO SEM SESSÃO. Com confirmação de e-mail ligada, o `signUp` NÃO
 *     devolve sessão — e sem sessão não há `auth.uid()`, então o vínculo não
 *     pode existir ainda. Tentar a RPC aí só produziria 42501; dizer
 *     "cadastro concluído" seria mentira.
 */

const cenario: {
  rpc: { nome: string; argumentos: unknown } | null;
  erroDaRpc: {
    code?: string;
    message?: string;
    hint?: string | null;
  } | null;
  respostaDoSignUp: unknown;
  erroDoSignUp: { code?: string; message?: string } | null;
  reenvio: unknown;
  assinatura: unknown;
} = {
  rpc: null,
  erroDaRpc: null,
  respostaDoSignUp: { user: null, session: null },
  erroDoSignUp: null,
  reenvio: null,
  assinatura: null,
};

const falso = {
  auth: {
    signUp: vi.fn(async (parametros: unknown) => {
      cenario.assinatura = parametros;
      if (cenario.erroDoSignUp) {
        return { data: { user: null, session: null }, error: cenario.erroDoSignUp };
      }
      return { data: cenario.respostaDoSignUp, error: null };
    }),
    resend: vi.fn(async (parametros: unknown) => {
      cenario.reenvio = parametros;
      return { data: {}, error: null };
    }),
  },
  rpc: vi.fn(async (nome: string, argumentos: unknown) => {
    cenario.rpc = { nome, argumentos };
    return { data: null, error: cenario.erroDaRpc };
  }),
};

vi.mock("../supabase/cliente", () => ({
  clienteNavegador: () => falso,
}));

import {
  CPF_DUPLICADO,
  EMAIL_NAO_CONFIRMADO,
  ErroDeCadastro,
  ErroDeVinculo,
  NOME_EM_BRANCO,
  SEM_SESSAO,
  cadastrar,
  garantirCliente,
  nomeParaCadastro,
  reenviarConfirmacao,
  urlDeRetorno,
} from "./cadastro";

const USUARIO = {
  id: "uid-1",
  email: "ana@exemplo.com",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2020-01-01",
} as never;

beforeEach(() => {
  cenario.rpc = null;
  cenario.erroDaRpc = null;
  cenario.respostaDoSignUp = { user: USUARIO, session: null };
  cenario.erroDoSignUp = null;
  cenario.reenvio = null;
  cenario.assinatura = null;
  falso.auth.signUp.mockClear();
  falso.rpc.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("garantirCliente — a forma da chamada", () => {
  it("chama canastra.garantir_cliente com o nome", async () => {
    await garantirCliente({ nome: "Ana" });
    expect(cenario.rpc?.nome).toBe("garantir_cliente");
    expect(cenario.rpc?.argumentos).toEqual({ nome: "Ana" });
  });

  /**
   * OMITE, não manda `null`. A RPC declara `telefone text DEFAULT NULL` e
   * `cpf text DEFAULT NULL`; omitir a chave é dizer "não informei" e deixar o
   * default do SQL valer. Mandar `{"cpf": null}` funciona hoje e atropela em
   * silêncio o dia em que a 0008 mudar algum default.
   */
  it("omite as chaves opcionais em vez de mandar null", async () => {
    await garantirCliente({ nome: "Ana", telefone: null, cpf: undefined });
    expect(cenario.rpc?.argumentos).toEqual({ nome: "Ana" });
    expect(Object.keys(cenario.rpc?.argumentos as object)).toEqual(["nome"]);
  });

  it("omite as opcionais que vieram só com espaços", async () => {
    await garantirCliente({ nome: "Ana", telefone: "   ", cpf: "  " });
    expect(cenario.rpc?.argumentos).toEqual({ nome: "Ana" });
  });

  it("manda telefone e cpf quando existem, já sem espaços nas pontas", async () => {
    await garantirCliente({
      nome: "Ana",
      telefone: " 31999990000 ",
      cpf: " 12345678901 ",
    });
    expect(cenario.rpc?.argumentos).toEqual({
      nome: "Ana",
      telefone: "31999990000",
      cpf: "12345678901",
    });
  });
});

describe("garantirCliente — ramificação por código", () => {
  async function recusarCom(erro: Record<string, unknown>) {
    cenario.erroDaRpc = erro;
    return (await garantirCliente({ nome: "Ana" }).catch(
      (e) => e,
    )) as ErroDeVinculo;
  }

  /**
   * O par que mais importa. Os dois chegam como HTTP 403 e só o SQLSTATE os
   * separa: 42501 leva ao login, 28000 leva ao "reenviar confirmação". Se as
   * duas asserções abaixo passarem a devolver o mesmo código, as duas telas
   * viram uma só e o laço começa.
   */
  it("42501 e 28000 são desfechos distintos", async () => {
    const semSessao = await recusarCom({
      code: SEM_SESSAO,
      message: "Não há sessão autenticada nesta chamada.",
      hint: "Entre na loja antes de criar o vínculo de cliente.",
    });
    const pendente = await recusarCom({
      code: EMAIL_NAO_CONFIRMADO,
      message: "Confirme o e-mail desta conta antes de continuar.",
      hint: "O link de confirmação foi enviado no cadastro; reenvie-o se necessário.",
    });

    expect(semSessao).toBeInstanceOf(ErroDeVinculo);
    expect(semSessao.codigo).toBe("42501");
    expect(pendente.codigo).toBe("28000");
    expect(semSessao.message).not.toBe(pendente.message);
    expect(semSessao.message).toMatch(/Entre na loja/);
    expect(pendente.message).toMatch(/[Cc]onfirme o e-mail/);
  });

  /**
   * `hint` é texto acionável em português que a 0008 escreveu de propósito
   * ("Confira o número digitado, ou entre com a conta que já usa este CPF").
   * Perdê-lo no caminho troca uma instrução por um beco sem saída.
   */
  it("preserva o hint da migração", async () => {
    const erro = await recusarCom({
      code: CPF_DUPLICADO,
      message: "Este CPF já está cadastrado em outra conta desta loja.",
      hint: "Confira o número digitado, ou entre com a conta que já usa este CPF.",
    });
    expect(erro.codigo).toBe("23505");
    expect(erro.dica).toMatch(/Confira o número digitado/);
  });

  it("traduz nome em branco (23502) para linguagem de formulário", async () => {
    const erro = await recusarCom({
      code: NOME_EM_BRANCO,
      message: "O nome é obrigatório para criar o cadastro.",
      hint: "Preencha o nome de quem vai receber a encomenda.",
    });
    expect(erro.codigo).toBe("23502");
    expect(erro.message).toMatch(/nome/i);
  });

  it("não some com a recusa quando o código é desconhecido", async () => {
    const erro = await recusarCom({ code: "XX999", message: "algo estranho" });
    expect(erro).toBeInstanceOf(ErroDeVinculo);
    expect(erro.codigo).toBe("XX999");
  });

  it("PGRST202 (função ausente) não vira erro de formulário", async () => {
    const erro = await recusarCom({
      code: "PGRST202",
      message: "Could not find the function",
    });
    // A 0008 não foi aplicada, ou `canastra` não está exposta na Data API.
    // Nada que a pessoa digite conserta isso, então a frase não pede correção.
    expect(erro.message).toMatch(/indispon/i);
  });

  it("não lança quando a RPC responde sem erro", async () => {
    cenario.erroDaRpc = null;
    await expect(garantirCliente({ nome: "Ana" })).resolves.toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */

describe("cadastrar", () => {
  it("recusa nome em branco antes de criar conta nenhuma", async () => {
    const erro = await cadastrar({
      nome: "   ",
      email: "a@b.co",
      senha: "12345678",
    }).catch((e) => e);

    expect(erro).toBeInstanceOf(ErroDeCadastro);
    // Sem esta trava, a conta seria criada e a recusa só chegaria dias depois,
    // na confirmação — quando o formulário não existe mais.
    expect(falso.auth.signUp).not.toHaveBeenCalled();
  });

  it("guarda só o nome em user_metadata", async () => {
    cenario.respostaDoSignUp = {
      user: USUARIO,
      session: { access_token: "t", user: USUARIO },
    };
    await cadastrar({
      nome: " Ana ",
      email: " ana@exemplo.com ",
      senha: "12345678",
      telefone: "31999990000",
    });

    const argumentos = cenario.assinatura as {
      email: string;
      options: { data: Record<string, unknown> };
    };
    expect(argumentos.email).toBe("ana@exemplo.com");
    expect(argumentos.options.data).toEqual({ nome: "Ana" });
    // Telefone e CPF NÃO viajam no JWT: a instância do Supabase é compartilhada
    // e `user_metadata` acompanha o token para qualquer projeto vizinho.
    expect(argumentos.options.data).not.toHaveProperty("telefone");
    expect(argumentos.options.data).not.toHaveProperty("cpf");
  });

  /**
   * Com confirmação de e-mail ligada — que é a configuração desta loja — o
   * `signUp` desta versão devolve `{ user, session: null }`. Sem sessão não há
   * `auth.uid()`, então a RPC só responderia 42501.
   */
  it("não tenta o vínculo quando o GoTrue retém a sessão", async () => {
    cenario.respostaDoSignUp = { user: USUARIO, session: null };

    const resultado = await cadastrar({
      nome: "Ana",
      email: "ana@exemplo.com",
      senha: "12345678",
    });

    expect(resultado).toEqual({
      situacao: "aguardandoConfirmacao",
      email: "ana@exemplo.com",
    });
    expect(falso.rpc).not.toHaveBeenCalled();
  });

  it("cria o vínculo quando o GoTrue já devolve sessão", async () => {
    cenario.respostaDoSignUp = {
      user: USUARIO,
      session: { access_token: "t", user: USUARIO },
    };

    const resultado = await cadastrar({
      nome: "Ana",
      email: "ana@exemplo.com",
      senha: "12345678",
      telefone: "31999990000",
    });

    expect(resultado.situacao).toBe("pronto");
    expect(cenario.rpc?.argumentos).toEqual({
      nome: "Ana",
      telefone: "31999990000",
    });
  });

  /**
   * ANTI-ENUMERAÇÃO. Com confirmação ligada, um e-mail JÁ cadastrado devolve
   * `{ user com identities: [], session: null }` e NENHUM erro — o GoTrue está
   * escondendo de propósito que a conta existe. Ramificar nisso desfaria na
   * interface a proteção que o servidor acabou de aplicar, entregando um
   * verificador de "quem tem conta nesta loja".
   */
  it("trata e-mail já cadastrado exatamente como cadastro novo", async () => {
    cenario.respostaDoSignUp = {
      user: { ...(USUARIO as object), identities: [] },
      session: null,
    };

    const resultado = await cadastrar({
      nome: "Ana",
      email: "ana@exemplo.com",
      senha: "12345678",
    });

    expect(resultado.situacao).toBe("aguardandoConfirmacao");
  });

  it("traduz a recusa do GoTrue para o português da loja", async () => {
    cenario.erroDoSignUp = {
      code: "weak_password",
      message: "Password should be at least 6 characters",
    };
    const erro = await cadastrar({
      nome: "Ana",
      email: "a@b.co",
      senha: "123",
    }).catch((e) => e);

    expect(erro).toBeInstanceOf(ErroDeCadastro);
    expect(erro.codigo).toBe("weak_password");
    expect(erro.message).not.toMatch(/Password should/);
  });
});

/* ------------------------------------------------------------------ */

describe("nomeParaCadastro", () => {
  /**
   * A ordem existe porque um nome ruim se conserta na tela de perfil, e
   * vínculo ausente não se conserta sozinho: a coluna `nome` é NOT NULL, então
   * ficar sem nome significa ficar sem linha em `canastra.clientes` — logado e
   * invisível para toda a RLS.
   */
  it("prefere o nome que o cadastro gravou", () => {
    expect(
      nomeParaCadastro({
        email: "ana@exemplo.com",
        user_metadata: { nome: "Ana Maria" },
      } as never),
    ).toBe("Ana Maria");
  });

  it("cai para o começo do e-mail quando não há metadado", () => {
    expect(
      nomeParaCadastro({ email: "ana@exemplo.com", user_metadata: {} } as never),
    ).toBe("ana");
  });

  it("nunca devolve vazio", () => {
    expect(nomeParaCadastro({ user_metadata: {} } as never)).toBe("Cliente");
    expect(
      nomeParaCadastro({ email: "", user_metadata: { nome: "  " } } as never),
    ).toBe("Cliente");
  });
});

describe("urlDeRetorno", () => {
  it("devolve undefined fora do navegador, em vez de inventar uma origem", () => {
    // Uma constante errada aqui manda o cliente do e-mail para o ambiente
    // errado; `undefined` faz o GoTrue usar a Site URL do projeto, que é o
    // padrão correto quando não há origem para ler.
    expect(urlDeRetorno("/account/verify-email")).toBeUndefined();
  });

  it("usa a origem atual quando há navegador", () => {
    (globalThis as any).window = { location: { origin: "https://loja.exemplo" } };
    expect(urlDeRetorno("/account/verify-email")).toBe(
      "https://loja.exemplo/account/verify-email",
    );
    delete (globalThis as any).window;
  });
});

describe("reenviarConfirmacao", () => {
  it("pede o reenvio do tipo signup para o e-mail informado", async () => {
    await reenviarConfirmacao("  ana@exemplo.com  ");
    expect(cenario.reenvio).toMatchObject({
      type: "signup",
      email: "ana@exemplo.com",
    });
  });
});
