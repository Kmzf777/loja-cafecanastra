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
 *   - AS DUAS METADES DO WHATSAPP SEPARADAS. O aviso de pedido se apoia em
 *     execução de contrato (LGPD Art. 7º V) e vem junto com o número; a
 *     promoção se apoia em consentimento (Art. 7º I) e é uma CHAMADA À PARTE,
 *     que só existe se a caixa foi marcada. Se as duas virarem uma, a loja
 *     passa a ter consentimento amarrado a "ou aceita ou não cria conta" — que
 *     não é livre, e não se sustenta nem na LGPD nem na política da Meta.
 */

type ErroDoPostgrest = {
  code?: string;
  message?: string;
  hint?: string | null;
};

const cenario: {
  rpc: { nome: string; argumentos: unknown } | null;
  erroDaRpc: ErroDoPostgrest | null;
  /**
   * Recusa de UMA rpc só, por nome. `erroDaRpc` continua valendo para todas —
   * este mapa é consultado primeiro, e existe porque o cadastro passou a fazer
   * DUAS chamadas com desfechos independentes: a promoção pode falhar sem que
   * a conta e o vínculo deixem de existir.
   */
  erroPorRpc: Record<string, ErroDoPostgrest> | null;
  respostaDoSignUp: unknown;
  erroDoSignUp: { code?: string; message?: string } | null;
  reenvio: unknown;
  assinatura: unknown;
  /** O que `lerWhatsappDaConta` pediu, e o que o PostgREST respondeu. */
  leitura: { tabela: string; colunas: string | null; userId: string | null } | null;
  linhaDoCliente: Record<string, unknown> | null;
  erroDaLeitura: ErroDoPostgrest | null;
  /** O que `voltarAReceberNoWhatsapp` mandou escrever. */
  escrita: {
    tabela: string;
    valores: Record<string, unknown>;
    userId?: string;
  } | null;
  erroDaEscrita: ErroDoPostgrest | null;
} = {
  rpc: null,
  erroDaRpc: null,
  erroPorRpc: null,
  respostaDoSignUp: { user: null, session: null },
  erroDoSignUp: null,
  reenvio: null,
  assinatura: null,
  leitura: null,
  linhaDoCliente: null,
  erroDaLeitura: null,
  escrita: null,
  erroDaEscrita: null,
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
    const especifico = cenario.erroPorRpc?.[nome] ?? null;
    return { data: null, error: especifico ?? cenario.erroDaRpc };
  }),
  from: vi.fn((tabela: string) => {
    cenario.leitura = { tabela, colunas: null, userId: null };
    const encadeado = {
      select: (colunas: string) => {
        if (cenario.leitura) cenario.leitura.colunas = colunas;
        return encadeado;
      },
      update: (valores: Record<string, unknown>) => {
        cenario.escrita = { tabela, valores };
        return encadeado;
      },
      eq: (_coluna: string, valor: string) => {
        if (cenario.leitura) cenario.leitura.userId = valor;
        if (cenario.escrita) cenario.escrita.userId = valor;
        // Um UPDATE termina no `.eq()`: é aqui que o postgrest-js dispara e
        // devolve o `{ error }`. Um SELECT continua para `.maybeSingle()`, que
        // ignora este retorno.
        return Object.assign(
          Promise.resolve({ data: null, error: cenario.erroDaEscrita }),
          encadeado,
        );
      },
      maybeSingle: async () => ({
        data: cenario.linhaDoCliente,
        error: cenario.erroDaLeitura,
      }),
    };
    return encadeado;
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
  RPC_DO_OPTIN,
  SEM_SESSAO,
  SEM_VINCULO,
  TELEFONE_EM_BRANCO,
  TELEFONE_INVALIDO,
  cadastrar,
  garantirCliente,
  lerWhatsappDaConta,
  nomeParaCadastro,
  reenviarConfirmacao,
  registrarOptinDeWhatsapp,
  telefoneParaRegistrar,
  urlDeRetorno,
  voltarAReceberNoWhatsapp,
} from "./cadastro";

/** Cadastro válido mínimo. Cada teste troca só o que o caso dele investiga. */
const VALIDO = {
  nome: "Ana",
  email: "ana@exemplo.com",
  senha: "12345678",
  telefone: "31999990000",
};

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
  cenario.erroPorRpc = null;
  cenario.respostaDoSignUp = { user: USUARIO, session: null };
  cenario.erroDoSignUp = null;
  cenario.reenvio = null;
  cenario.assinatura = null;
  cenario.leitura = null;
  cenario.linhaDoCliente = null;
  cenario.erroDaLeitura = null;
  cenario.escrita = null;
  cenario.erroDaEscrita = null;
  falso.auth.signUp.mockClear();
  falso.rpc.mockClear();
  falso.from.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** Os nomes das RPCs chamadas, na ordem. É a asserção da SEPARAÇÃO. */
function rpcsChamadas(): string[] {
  return falso.rpc.mock.calls.map((c) => c[0] as string);
}

/** Os argumentos da n-ésima chamada de RPC. */
function argumentosDaRpc(n: number): unknown {
  return falso.rpc.mock.calls[n]?.[1];
}

/** Cenário de cadastro em que o GoTrue já devolve sessão (confirmação desligada). */
function comSessao() {
  cenario.respostaDoSignUp = {
    user: USUARIO,
    session: { access_token: "t", user: USUARIO },
  };
}

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
    const erro = await cadastrar({ ...VALIDO, nome: "   " }).catch((e) => e);

    expect(erro).toBeInstanceOf(ErroDeCadastro);
    // Sem esta trava, a conta seria criada e a recusa só chegaria dias depois,
    // na confirmação — quando o formulário não existe mais.
    expect(falso.auth.signUp).not.toHaveBeenCalled();
  });

  it("guarda só o nome em user_metadata", async () => {
    comSessao();
    await cadastrar({
      ...VALIDO,
      nome: " Ana ",
      email: " ana@exemplo.com ",
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

    const resultado = await cadastrar({ ...VALIDO, promocoes: true });

    expect(resultado).toEqual({
      situacao: "aguardandoConfirmacao",
      email: "ana@exemplo.com",
    });
    // Nem o vínculo, NEM a promoção: sem sessão não há `auth.uid()`, e as duas
    // responderiam 42501. O número e a preferência se perdem aqui — é o preço
    // de telefone não viajar em `user_metadata`, e o bloco da área da conta é
    // quem os recupera depois da confirmação.
    expect(falso.rpc).not.toHaveBeenCalled();
  });

  it("cria o vínculo quando o GoTrue já devolve sessão", async () => {
    comSessao();

    const resultado = await cadastrar(VALIDO);

    expect(resultado.situacao).toBe("pronto");
    expect(cenario.rpc?.argumentos).toEqual({
      nome: "Ana",
      telefone: "5531999990000",
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

    const resultado = await cadastrar(VALIDO);

    expect(resultado.situacao).toBe("aguardandoConfirmacao");
  });

  it("traduz a recusa do GoTrue para o português da loja", async () => {
    cenario.erroDoSignUp = {
      code: "weak_password",
      message: "Password should be at least 6 characters",
    };
    const erro = await cadastrar({ ...VALIDO, senha: "123" }).catch((e) => e);

    expect(erro).toBeInstanceOf(ErroDeCadastro);
    expect(erro.codigo).toBe("weak_password");
    expect(erro.message).not.toMatch(/Password should/);
  });
});

/* ------------------------------------------------------------------ *
 * O WhatsApp: um número obrigatório e DOIS consentimentos separados
 * ------------------------------------------------------------------ */

describe("cadastrar — o número", () => {
  /**
   * O servidor não deveria ter de limpar o que a tela pode limpar. Mais do que
   * estética: `clientes.telefone` é a semente do PRIMEIRO envio, e o bot faz
   * `paraE164` na hora de mandar (`notificacoes.js`). Um "(31) 99999-0000"
   * gravado cru sobrevive porque ALGUÉM normaliza depois — e no dia em que esse
   * alguém mudar, o número gravado deixa de casar com o `from` do webhook e o
   * cliente vira "desconhecido" para o roteador.
   */
  it("manda o telefone para a RPC só com dígitos, em E.164", async () => {
    comSessao();
    await cadastrar({ ...VALIDO, telefone: "  (31) 99999-0000 " });

    expect(argumentosDaRpc(0)).toEqual({
      nome: "Ana",
      telefone: "5531999990000",
    });
    expect(String((argumentosDaRpc(0) as { telefone: string }).telefone)).toMatch(
      /^\d+$/,
    );
  });

  /**
   * RECUSADO NA TELA, ANTES DA REDE. O campo é `required` no HTML, mas isso é
   * o navegador cooperando — e o campo pode chegar vazio por autofill parcial,
   * por `noValidate`, ou por um formulário enviado por script. A trava tem de
   * estar aqui, ANTES do `signUp`: sem ela a conta nasce sem número, e quem se
   * cadastra não passa mais por esta tela nunca — o vínculo seguinte é criado
   * por `montarUsuario()`, que só sabe o nome.
   */
  it("recusa cadastro sem telefone antes de qualquer chamada de rede", async () => {
    const erro = await cadastrar({ ...VALIDO, telefone: "   " }).catch((e) => e);

    expect(erro).toBeInstanceOf(ErroDeCadastro);
    expect(erro.codigo).toBe(TELEFONE_EM_BRANCO);
    expect(erro.message).toMatch(/WhatsApp/i);
    expect(falso.auth.signUp).not.toHaveBeenCalled();
    expect(falso.rpc).not.toHaveBeenCalled();
  });

  it("recusa o que não é celular brasileiro plausível, com frase própria", async () => {
    comSessao();
    const erro = await cadastrar({ ...VALIDO, telefone: "31 3333-0000" }).catch(
      (e) => e,
    );

    expect(erro).toBeInstanceOf(ErroDeCadastro);
    expect(erro.codigo).toBe(TELEFONE_INVALIDO);
    // FRASE PRÓPRIA, e não a mesma do campo vazio: "preencha" para quem não
    // preencheu e "confira o número" para quem preencheu errado são instruções
    // diferentes, e a segunda precisa dizer o formato esperado.
    expect(erro.message).not.toMatch(/^Informe/);
    expect(erro.message).toMatch(/DDD/i);
    expect(falso.auth.signUp).not.toHaveBeenCalled();
  });
});

describe("cadastrar — as duas metades do consentimento", () => {
  /**
   * DUAS BASES LEGAIS, DUAS CHAMADAS.
   *
   * O aviso de pedido é execução de contrato (Art. 7º V): vem junto com o
   * número, dentro de `garantir_cliente`, que carimba `whatsapp_optin_em`
   * (0017). A promoção é consentimento (Art. 7º I): cláusula destacada, caixa
   * desmarcada, e uma chamada à parte — `registrar_optin_whatsapp`.
   *
   * Se um dia as duas virarem uma chamada só, o consentimento passa a ser
   * condição para criar a conta. Este teste é o que fica vermelho.
   */
  it("promoção marcada vira uma chamada separada, depois do vínculo", async () => {
    comSessao();
    await cadastrar({ ...VALIDO, promocoes: true });

    expect(rpcsChamadas()).toEqual(["garantir_cliente", RPC_DO_OPTIN]);
    expect(argumentosDaRpc(1)).toEqual({ promocoes: true });
    // O telefone NÃO se repete na segunda chamada: `garantir_cliente` já o
    // gravou, e mandá-lo de novo daria a esta RPC um segundo caminho até a
    // coluna — dois lugares para procurar quando o número estiver errado.
    expect(argumentosDaRpc(1)).not.toHaveProperty("telefone");
  });

  it("promoção desmarcada não vira chamada nenhuma", async () => {
    comSessao();
    await cadastrar({ ...VALIDO, promocoes: false });

    expect(rpcsChamadas()).toEqual(["garantir_cliente"]);
  });

  it("sem a caixa no formulário, também não vira chamada nenhuma", async () => {
    // O padrão da AUSÊNCIA é o mesmo do "não marcado". Consentimento não tem
    // valor default.
    comSessao();
    await cadastrar(VALIDO);

    expect(rpcsChamadas()).toEqual(["garantir_cliente"]);
  });

  /**
   * A promoção é o ACESSÓRIO. Se ela falhar, a conta existe, o vínculo existe e
   * o aviso de pedido está carimbado — derrubar o cadastro inteiro por causa
   * dela devolveria a pessoa a um formulário que não consegue mais criar a
   * conta (o e-mail já está tomado) e a deixaria sem nada.
   */
  it("recusa da promoção não desfaz o cadastro", async () => {
    comSessao();
    cenario.erroPorRpc = {
      [RPC_DO_OPTIN]: { code: "42501", message: "sem sessão" },
    };

    const resultado = await cadastrar({ ...VALIDO, promocoes: true });

    expect(resultado.situacao).toBe("pronto");
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("registrarOptinDeWhatsapp", () => {
  it("manda o telefone em E.164 e omite o que não foi informado", async () => {
    await registrarOptinDeWhatsapp({ telefone: "(31) 99999-0000" });

    expect(cenario.rpc?.nome).toBe(RPC_DO_OPTIN);
    expect(cenario.rpc?.argumentos).toEqual({ telefone: "5531999990000" });
  });

  it("desmarcar a promoção é `false` explícito, e não a ausência da chave", async () => {
    // A RPC distingue três coisas: NULL ("não mexa"), true (consentiu) e false
    // (revogou). Omitir a chave na revogação faria a caixa desmarcada não
    // desmarcar nada — o pior desfecho possível para o Art. 8º §5º.
    await registrarOptinDeWhatsapp({ promocoes: false });

    expect(cenario.rpc?.argumentos).toEqual({ promocoes: false });
  });

  it("recusa telefone que não é celular brasileiro antes de chamar a RPC", async () => {
    const erro = await registrarOptinDeWhatsapp({ telefone: "999" }).catch(
      (e) => e,
    );

    expect(erro).toBeInstanceOf(ErroDeVinculo);
    expect(erro.codigo).toBe(TELEFONE_INVALIDO);
    expect(falso.rpc).not.toHaveBeenCalled();
  });

  it("não chama a RPC quando não há nada a registrar", async () => {
    await registrarOptinDeWhatsapp({});
    expect(falso.rpc).not.toHaveBeenCalled();
  });

  it("traduz a recusa de quem ainda não é cliente da loja", async () => {
    cenario.erroDaRpc = {
      code: SEM_VINCULO,
      message: "Esta conta ainda não tem cadastro nesta loja.",
      hint: "Confirme o e-mail e entre de novo.",
    };

    const erro = await registrarOptinDeWhatsapp({ promocoes: true }).catch(
      (e) => e,
    );

    expect(erro).toBeInstanceOf(ErroDeVinculo);
    expect(erro.codigo).toBe(SEM_VINCULO);
    expect(erro.message).toMatch(/cadastro/i);
    // A frase não pode ser a do 42501 ("Entre na loja"): quem já está logado e
    // lê "entre na loja" não tem o que fazer.
    expect(erro.message).not.toMatch(/^Entre na loja/);
  });
});

describe("telefoneParaRegistrar — trocar o número que entrou errado", () => {
  // O PROBLEMA QUE ESTA FUNÇÃO FECHA: o telefone era gravável UMA vez e nunca
  // mais. Não há tela de perfil, `garantir_cliente` faz RETURN quando a linha
  // já existe (0017), o painel só lê e não há `UPDATE clientes SET telefone` no
  // Express. Quem digitasse 99999-0001 em vez de 99999-0000 — formato válido,
  // passa por toda validação — mandaria "Olá, Ana. Recebemos seu pedido…" para
  // um estranho a cada mudança de status, veria o número errado na área da
  // conta, e não teria onde trocar. Pior: se o estranho apertasse "Parar
  // avisos", quem ficaria sem avisos era a Ana.
  //
  // A decisão de tela mora AQUI e não no componente porque componente não é
  // testado nesta casa (o vitest roda em `node`, sem jsdom, e só sobre `.ts`).

  it("número novo, cadastro sem número: manda o que a pessoa digitou", () => {
    expect(telefoneParaRegistrar(null, "(31) 99999-0000")).toBe("(31) 99999-0000");
    expect(telefoneParaRegistrar(undefined, "31999990000")).toBe("31999990000");
  });

  it("número diferente do gravado: manda — é a troca, e ela RE-CARIMBA o consentimento", () => {
    // `registrar_optin_whatsapp` (0019) grava `whatsapp_optin_em = now()`
    // sempre que há telefone, de propósito: o carimbo tem de descrever o número
    // que está gravado AGORA. Um carimbo velho sobre um número novo é a prova
    // errada, que é pior que prova nenhuma porque parece prova.
    expect(telefoneParaRegistrar("5531999990000", "(31) 99999-0001")).toBe(
      "(31) 99999-0001",
    );
  });

  it("MESMO número, escrito de outro jeito: não manda nada", () => {
    // A COMPARAÇÃO É PELO NÚMERO NORMALIZADO, e não pelo texto: o campo mostra
    // a máscara, o banco guarda o que a pessoa digitou no cadastro (quase
    // ninguém digita "+55"), e as três formas abaixo são o MESMO aparelho.
    // Mandá-las re-carimbaria `whatsapp_optin_em` a cada visita à tela,
    // apagando a data em que a pessoa de fato deixou o número.
    for (const digitado of [
      "5531999990000",
      "31999990000",
      "(31) 99999-0000",
      "+55 (31) 99999-0000",
      "  31 99999-0000  ",
    ]) {
      expect(telefoneParaRegistrar("5531999990000", digitado)).toBeUndefined();
    }
  });

  it("campo em branco não manda nada — apagar o número não é um gesto desta tela", () => {
    // A RPC é `COALESCE(telefone_limpo, c.telefone)`: ela não sabe apagar. Um
    // branco que virasse chamada gravaria só a preferência e a tela diria
    // "está tudo salvo" sobre um campo que a pessoa esvaziou de propósito.
    expect(telefoneParaRegistrar("5531999990000", "")).toBeUndefined();
    expect(telefoneParaRegistrar("5531999990000", "   ")).toBeUndefined();
    expect(telefoneParaRegistrar(null, "")).toBeUndefined();
  });

  it("texto que não é telefone MANDA, para a recusa acontecer com nome", () => {
    // A armadilha: comparar "não dá para normalizar" com "não dá para
    // normalizar" e concluir "não mudou". O que a pessoa digitou seria
    // engolido em silêncio e a tela diria "salvo". Aqui ele segue para
    // `registrarOptinDeWhatsapp`, que recusa com TELEFONE_INVALIDO ANTES da
    // rede — que é a mensagem que a pessoa precisa ler.
    expect(telefoneParaRegistrar("5531999990000", "999")).toBe("999");
    expect(telefoneParaRegistrar("nao-e-telefone", "tambem-nao-e")).toBe("tambem-nao-e");
    expect(telefoneParaRegistrar("nao-e-telefone", "nao-e-telefone")).toBe("nao-e-telefone");
  });
});

describe("lerWhatsappDaConta", () => {
  it("lê as três colunas que a tela precisa, só da própria linha", async () => {
    cenario.linhaDoCliente = {
      telefone: "5531999990000",
      whatsapp_promo_optin_em: null,
      whatsapp_optout_em: null,
    };

    const contato = await lerWhatsappDaConta("uid-1");

    expect(cenario.leitura?.tabela).toBe("clientes");
    expect(cenario.leitura?.userId).toBe("uid-1");
    expect(contato).toEqual({
      telefone: "5531999990000",
      promocoes: false,
      parado: false,
    });
  });

  it("carimbo preenchido vira `true`; a tela não vê timestamp", async () => {
    cenario.linhaDoCliente = {
      telefone: "5531999990000",
      whatsapp_promo_optin_em: "2026-08-22T10:00:00Z",
      whatsapp_optout_em: "2026-08-22T11:00:00Z",
    };

    expect(await lerWhatsappDaConta("uid-1")).toEqual({
      telefone: "5531999990000",
      promocoes: true,
      parado: true,
    });
  });

  it("devolve null quando a leitura falha, em vez de inventar estado", async () => {
    // Falhar para `null` faz o bloco da tela sumir. O inverso — assumir "sem
    // telefone" — pediria o número de novo a quem já o deu, e um segundo
    // carimbo de opt-in por cima de um erro de rede.
    cenario.erroDaLeitura = { code: "PGRST301", message: "jwt expired" };

    expect(await lerWhatsappDaConta("uid-1")).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("sem telefone gravado devolve telefone nulo, e não erro", async () => {
    cenario.linhaDoCliente = {
      telefone: null,
      whatsapp_promo_optin_em: null,
      whatsapp_optout_em: null,
    };

    expect(await lerWhatsappDaConta("uid-1")).toEqual({
      telefone: null,
      promocoes: false,
      parado: false,
    });
  });
});

describe("voltarAReceberNoWhatsapp", () => {
  /**
   * O ÚNICO gesto de WhatsApp que não passa pela RPC, e não passar é a escolha:
   * `whatsapp_optout_em` é a única das cinco colunas que a 0018 deixou aberta
   * ao titular. Se este teste passar a ver uma chamada de `rpc`, alguém moveu
   * para a função privilegiada um poder que ela não precisa ter.
   */
  it("limpa só o carimbo de parada, na própria linha, sem RPC", async () => {
    await voltarAReceberNoWhatsapp("uid-1");

    expect(cenario.escrita?.tabela).toBe("clientes");
    expect(cenario.escrita?.valores).toEqual({ whatsapp_optout_em: null });
    expect(cenario.escrita?.userId).toBe("uid-1");
    expect(falso.rpc).not.toHaveBeenCalled();
  });

  it("não mexe no carimbo de opt-in — voltar não é consentir de novo", async () => {
    await voltarAReceberNoWhatsapp("uid-1");

    expect(cenario.escrita?.valores).not.toHaveProperty("whatsapp_optin_em");
    expect(cenario.escrita?.valores).not.toHaveProperty("telefone");
  });

  it("propaga a recusa em vez de fingir que voltou", async () => {
    cenario.erroDaEscrita = { code: "42501", message: "permission denied" };

    const erro = await voltarAReceberNoWhatsapp("uid-1").catch((e) => e);

    expect(erro).toBeInstanceOf(ErroDeVinculo);
    expect(erro.codigo).toBe("42501");
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
