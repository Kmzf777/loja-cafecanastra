import { describe, it, expect, vi } from "vitest";

/**
 * O que estes testes protegem é a CERCA do painel — cada decisão cuja falha é
 * invisível até o dia em que alguém entra onde não devia:
 *
 *   - falha de consulta abrindo o acesso .. o painel abre por causa de rede ruim;
 *   - `?de=` frouxo ....................... phishing com o domínio verdadeiro,
 *                                           logo depois da senha do GESTOR;
 *   - `?de=` fora de /dashboard ........... o login do painel vira trampolim;
 *   - anônimo lido como "sistema fora" .... toda visita deslogada acusa uma
 *                                           queda que não houve, e o aviso
 *                                           perde o sentido quando for real.
 *
 * Nenhuma delas aparece em `next build`.
 *
 * `next/navigation` e o cliente de servidor são mockados porque o módulo os
 * importa no topo e não há runtime do Next sob o Vitest — mesmo recurso de
 * `lib/supabase/servidor.test.ts`. Nada aqui exercita a parte impura: o que se
 * testa é a decisão, que é pura de propósito.
 */
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));
vi.mock("../supabase/servidor", () => ({
  criarClienteServidor: vi.fn(),
}));

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decidirAcessoAoPainel,
  destinoDoPainel,
  ehFalhaDeInfraestrutura,
} from "./painel-servidor";

const BASE = {
  temSessao: false,
  ehAdmin: false,
  falhouConsulta: false,
  rotaPedida: "/dashboard",
};

describe("decidirAcessoAoPainel", () => {
  it("deixa entrar quem tem sessão e linha em admins", () => {
    expect(
      decidirAcessoAoPainel({ ...BASE, temSessao: true, ehAdmin: true }),
    ).toEqual({ tipo: "entra" });
  });

  it("manda quem não tem sessão para a entrada do painel", () => {
    const decisao = decidirAcessoAoPainel(BASE);
    expect(decisao).toEqual({
      tipo: "redireciona",
      destino: "/dashboard/entrar?de=%2Fdashboard",
      motivo: "sem-sessao",
    });
  });

  it("carrega a rota pedida no ?de=, codificada", () => {
    const decisao = decidirAcessoAoPainel({
      ...BASE,
      rotaPedida: "/dashboard/orders",
    });
    expect(decisao).toMatchObject({
      destino: "/dashboard/entrar?de=%2Fdashboard%2Forders",
    });
  });

  it("manda cliente logado para a conta, com o aviso de painel negado", () => {
    expect(decidirAcessoAoPainel({ ...BASE, temSessao: true })).toEqual({
      tipo: "redireciona",
      destino: "/account?painel=negado",
      motivo: "nao-e-admin",
    });
  });

  /**
   * O caso que este arquivo existe para fixar. Se um dia alguém "consertar"
   * isto para deixar entrar quando a consulta falha, é aqui que fica vermelho.
   */
  it("FECHA o acesso quando a consulta ao banco falha, mesmo com sessão", () => {
    const decisao = decidirAcessoAoPainel({
      ...BASE,
      temSessao: true,
      falhouConsulta: true,
    });
    expect(decisao.tipo).toBe("redireciona");
    expect(decisao).toMatchObject({ motivo: "falha-de-consulta" });
  });

  it("não deixa entrar nem quando a consulta falha depois de dizer que é admin", () => {
    const decisao = decidirAcessoAoPainel({
      ...BASE,
      temSessao: true,
      ehAdmin: true,
      falhouConsulta: true,
    });
    expect(decisao.tipo).toBe("redireciona");
  });

  /**
   * A falha vai na URL, e não só no retorno: o gestor precisa LER que foi
   * problema de sistema. Sem isto ele leria "faça login" e concluiria que
   * errou a senha — e trocaria uma senha que estava certa.
   */
  it("avisa na URL que foi falha de infraestrutura, não senha errada", () => {
    const decisao = decidirAcessoAoPainel({
      ...BASE,
      temSessao: true,
      falhouConsulta: true,
    });
    expect(decisao).toMatchObject({
      destino: "/dashboard/entrar?de=%2Fdashboard&aviso=falha",
    });
  });

  it("a falha de consulta vence a ausência de sessão", () => {
    const decisao = decidirAcessoAoPainel({ ...BASE, falhouConsulta: true });
    expect(decisao).toMatchObject({ motivo: "falha-de-consulta" });
  });
});

describe("destinoDoPainel", () => {
  it("aceita a raiz do painel", () => {
    expect(destinoDoPainel("/dashboard")).toBe("/dashboard");
  });

  it("aceita rota interna do painel com query", () => {
    expect(destinoDoPainel("/dashboard/orders?p=2")).toBe(
      "/dashboard/orders?p=2",
    );
  });

  it("cai no padrão quando não veio nada", () => {
    expect(destinoDoPainel(null)).toBe("/dashboard");
    expect(destinoDoPainel(undefined)).toBe("/dashboard");
    expect(destinoDoPainel("")).toBe("/dashboard");
  });

  // Os mesmos vetores que `destinoSeguro` já cobre — repetidos aqui porque
  // esta função é a que a tela do GESTOR usa, e a garantia tem de ser dela.
  it("recusa URL protocol-relative", () => {
    expect(destinoDoPainel("//evil.com")).toBe("/dashboard");
  });

  it("recusa a variante com contrabarra que alguns navegadores seguem", () => {
    expect(destinoDoPainel("/\\evil.com")).toBe("/dashboard");
  });

  it("recusa URL absoluta", () => {
    expect(destinoDoPainel("https://evil.com")).toBe("/dashboard");
  });

  // A trava nova: interno não basta, tem de ser do painel.
  it("recusa caminho interno que não é do painel", () => {
    expect(destinoDoPainel("/account")).toBe("/dashboard");
    expect(destinoDoPainel("/")).toBe("/dashboard");
  });

  it("recusa prefixo parecido que não está SOB /dashboard", () => {
    expect(destinoDoPainel("/dashboardevil")).toBe("/dashboard");
    expect(destinoDoPainel("/dashboard-antigo")).toBe("/dashboard");
  });

  it("recusa travessia de diretório, que o navegador normaliza para fora", () => {
    expect(destinoDoPainel("/dashboard/../account")).toBe("/dashboard");
  });

  /**
   * O furo que a revisão de segurança provou ao vivo. A versão anterior recusava
   * `..` com `bruto.includes("..")` — casamento de TEXTO, que só enxerga o ponto
   * literal. `%2e%2e` é o mesmo segmento escrito de outro jeito: o comentário da
   * função prometia que travessia não passava, e passava.
   *
   * O vetor real chegava como `%252e%252e` na URL; o `searchParams` do Next
   * decodifica uma vez e entrega `%2e%2e` a esta função, que devolvia
   * `/dashboard/%2e%2e/account` — e o NAVEGADOR normaliza isso para `/account`.
   */
  it("recusa travessia escrita em percent-encoding (%2e%2e)", () => {
    expect(destinoDoPainel("/dashboard/%2e%2e/account")).toBe("/dashboard");
  });

  it("recusa travessia com os dois pontos escritos de formas diferentes", () => {
    expect(destinoDoPainel("/dashboard/.%2e/account")).toBe("/dashboard");
    expect(destinoDoPainel("/dashboard/%2e./account")).toBe("/dashboard");
  });

  it("recusa o painel escrito em outra caixa — o caminho é sensível a maiúscula", () => {
    expect(destinoDoPainel("/DASHBOARD/orders")).toBe("/dashboard");
    expect(destinoDoPainel("/Dashboard")).toBe("/dashboard");
  });

  /**
   * A contrabarra NÃO é recusada aqui, e isso é resultado, não descuido: o
   * parser de URL a normaliza para `/` em esquemas especiais, então
   * `/dashboard\evil` VIRA `/dashboard/evil` — um caminho sob o painel, na
   * mesma origem. O que importava era `/\evil.com`, que vira `//evil.com` e sai
   * do site; esse continua recusado logo acima.
   */
  it("normaliza contrabarra dentro do painel em vez de recusar", () => {
    expect(destinoDoPainel("/dashboard\\evil")).toBe("/dashboard/evil");
  });

  it("preserva query e fragmento de uma rota legítima", () => {
    expect(destinoDoPainel("/dashboard/orders?p=2#x")).toBe(
      "/dashboard/orders?p=2#x",
    );
  });

  /**
   * Nenhuma quebra de linha pode sobreviver até o cabeçalho `Location:`. O
   * parser de URL remove tab/CR/LF e mantém o resto percent-encoded, então o
   * valor que sai daqui é sempre uma linha só.
   */
  it("não deixa quebra de linha chegar ao Location", () => {
    expect(destinoDoPainel("/dashboard/x\ny")).not.toContain("\n");
    expect(destinoDoPainel("/dashboard/x%0Ay")).not.toContain("\n");
  });

  /**
   * O que o parser NÃO consegue ler cai no padrão. Vale registrar o que ele
   * consegue: percent-encoding quebrado (`%E0%A4%A`) NÃO faz `new URL` lançar —
   * ele preserva a sequência como está. Isso é seguro porque o resultado
   * continua sob `/dashboard` e na mesma origem; no pior caso é uma rota que o
   * painel não conhece. O `try/catch` existe para os casos que lançam de
   * verdade, como um host impossível.
   */
  it("recusa o que o parser de URL não consegue ler", () => {
    expect(destinoDoPainel("http://[")).toBe("/dashboard");
    expect(destinoDoPainel("https://%")).toBe("/dashboard");
  });

  it("percent-encoding quebrado não escapa do painel", () => {
    expect(destinoDoPainel("/dashboard/%E0%A4%A")).toBe(
      "/dashboard/%E0%A4%A",
    );
  });

  /**
   * A porta de entrada não pode ser destino de si mesma: `?de=/dashboard/entrar`
   * devolveria a pessoa ao formulário logo depois de ela entrar — um vaivém que
   * parece "o login não funcionou".
   */
  /**
   * Os quatro que já passavam e não estavam travados. Não são regressões — são
   * exatamente o tipo de comportamento que uma refatoração futura quebraria em
   * silêncio, porque hoje ninguém olha para eles.
   */
  /**
   * Duplo percent-encoding NÃO é travessia: `%25` é um "%" literal, então
   * `%252e%252e` é um segmento de verdade CHAMADO `%2e%2e`, e não `..`. Ele
   * continua sob `/dashboard`, na mesma origem — no pior caso é uma rota que o
   * painel não conhece. O que importa é a linha de baixo: se algo decodificar
   * uma vez antes de chegar aqui, vira `%2e%2e` e AÍ o parser normaliza para
   * `/account`, que é recusado. As duas pontas ficam travadas.
   */
  it("trata duplo percent-encoding como segmento literal, não como travessia", () => {
    expect(destinoDoPainel("/dashboard/%252e%252e/account")).toBe(
      "/dashboard/%252e%252e/account",
    );
    expect(destinoDoPainel("/dashboard/%2e%2e/account")).toBe("/dashboard");
  });

  it("recusa //dashboard, que o parser lê como host e não como caminho", () => {
    expect(destinoDoPainel("//dashboard")).toBe("/dashboard");
    expect(destinoDoPainel("//dashboard/orders")).toBe("/dashboard");
  });

  /**
   * Byte nulo é recusado, e não apenas escapado: `/dashboard%00/x` não começa
   * com `/dashboard/` (depois da raiz vem `%`, não barra), então cai fora da
   * trava de prefixo. Vale para a forma escrita e para o byte cru.
   */
  it("recusa byte nulo colado na raiz do painel", () => {
    expect(destinoDoPainel("/dashboard%00/x")).toBe("/dashboard");
    expect(destinoDoPainel("/dashboard\0/x")).toBe("/dashboard");
  });

  it("recusa travessia que sobe até acima da raiz", () => {
    expect(destinoDoPainel("/dashboard/../..")).toBe("/dashboard");
    expect(destinoDoPainel("/dashboard/../../etc")).toBe("/dashboard");
  });

  it("recusa a própria tela de entrada como destino", () => {
    expect(destinoDoPainel("/dashboard/entrar")).toBe("/dashboard");
    expect(destinoDoPainel("/dashboard/entrar?de=%2Fdashboard")).toBe(
      "/dashboard",
    );
    expect(destinoDoPainel("/dashboard/entrar/foo")).toBe("/dashboard");
  });

  it("recusa ?de= repetido, que chega como lista", () => {
    expect(destinoDoPainel(["/dashboard", "https://evil.com"])).toBe(
      "/dashboard",
    );
  });
});

/**
 * O TESTE DE ESTRUTURA — o que impede a próxima rota de nascer pública.
 *
 * O guard mora em `app/dashboard/(protegido)/layout.tsx` e alcança tudo o que
 * estiver dentro daquele grupo. Uma rota criada FORA dele, direto em
 * `app/dashboard/`, não herda layout nenhum e nasce aberta — sem erro, sem
 * aviso, sem nada vermelho. Nenhum teste de função pura pegaria isso, porque o
 * problema não está em nenhuma função: está na ausência de uma.
 *
 * Então o teste lê o diretório. Ele falha no dia em que alguém acrescentar uma
 * pasta em `app/dashboard/` sem escolher um dos dois grupos — e a mensagem diz o
 * que fazer.
 */
describe("estrutura de rotas de /dashboard", () => {
  const RAIZ = join(__dirname, "..", "..", "app", "dashboard");

  function pastas(caminho: string): string[] {
    return readdirSync(caminho, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  }

  /**
   * RECURSIVA, e a primeira versão não era — o furo que a re-revisão pegou.
   * Lendo só o primeiro nível, uma rota pública criada UM nível abaixo
   * (`(publico)/entrar/ajuda/page.tsx`, servindo `/dashboard/entrar/ajuda`)
   * passava verde. O grupo público é a exceção nomeada; a exceção tem de ser
   * auditável até o fim, não só na entrada.
   */
  function pastasRecursivas(dir: string, prefixo = ""): string[] {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) => [
        prefixo + e.name,
        ...pastasRecursivas(join(dir, e.name), `${prefixo}${e.name}/`),
      ])
      .sort();
  }

  function arquivosRecursivos(dir: string, prefixo = ""): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? arquivosRecursivos(join(dir, e.name), `${prefixo}${e.name}/`)
        : [prefixo + e.name],
    );
  }

  it("tudo sob /dashboard mora num grupo: (protegido) ou (publico)", () => {
    expect(pastas(RAIZ)).toEqual(["(protegido)", "(publico)"]);
  });

  /**
   * O grupo público é uma exceção nomeada, e o teste existe para que ela
   * continue sendo UMA — em qualquer profundidade. Acrescentar rota ali é
   * decisão de segurança: a pessoa tem de escrever `(publico)` e ver isto
   * ficar vermelho.
   */
  it("a única rota pública do painel é a tela de entrada, em qualquer nível", () => {
    expect(pastasRecursivas(join(RAIZ, "(publico)"))).toEqual(["entrar"]);
  });

  it("o grupo protegido tem o layout que faz a checagem", () => {
    const arquivos = readdirSync(join(RAIZ, "(protegido)"));
    expect(arquivos).toContain("layout.tsx");
  });

  /**
   * ROUTE HANDLER E SERVER ACTION NÃO PASSAM POR LAYOUT.
   *
   * O caso do handler já era conhecido. O da Server Action é pior porque é
   * INVISÍVEL: a ação POSTa para a própria rota, EXECUTA, e só então a página
   * re-renderiza — momento em que o layout finalmente chama
   * `exigirAdminNoPainel`. Ou seja, a checagem roda DEPOIS de a ação ter
   * gravado no banco. O painel novo é feito de Server Actions.
   *
   * A regra deixou de ser "não existe" e passou a ser "todo mundo chama a
   * checagem", porque proibir era proibir o painel de funcionar.
   *
   * `arquivosRecursivos` é a mesma varredura que o teste antigo usava — ela
   * devolve o caminho relativo à RAIZ, e é esse caminho que entra na mensagem
   * de falha. Quem quebrar isto precisa ler o NOME DO ARQUIVO na saída
   * vermelha, senão a trava obriga a caçar o culpado.
   */
  it("todo Route Handler sob /dashboard chama a checagem na própria função", () => {
    const handlers = arquivosRecursivos(RAIZ).filter((a) =>
      /(^|\/)route\.(ts|tsx|js|jsx)$/.test(a),
    );
    for (const h of handlers) {
      const fonte = readFileSync(join(RAIZ, h), "utf8");
      expect(fonte, `${h} não chama exigirAdminEmAcao`).toMatch(
        /exigirAdminEmAcao\s*\(/,
      );
    }
  });

  /**
   * A diretiva vale no topo do ARQUIVO (todas as exportações viram ações) e no
   * topo de uma FUNÇÃO (só ela vira). Por isso a regex é `/m` e ancorada em
   * início de linha, não em início de arquivo — e aceita as duas aspas, porque
   * `'use server'` e `"use server"` são a mesma diretiva para o compilador e
   * seria absurdo a trava depender de qual delas a pessoa digitou.
   */
  it('todo arquivo com "use server" sob /dashboard chama a checagem', () => {
    const suspeitos = arquivosRecursivos(RAIZ).filter((a) =>
      /\.(ts|tsx)$/.test(a),
    );
    for (const arquivo of suspeitos) {
      const fonte = readFileSync(join(RAIZ, arquivo), "utf8");
      if (!/^\s*["']use server["']/m.test(fonte)) continue;
      expect(
        fonte,
        `${arquivo} declara "use server" e não chama exigirAdminEmAcao`,
      ).toMatch(/exigirAdminEmAcao\s*\(/);
    }
  });
});

describe("ehFalhaDeInfraestrutura", () => {
  it("é falha quando o fetch nem chegou (sem status)", () => {
    expect(ehFalhaDeInfraestrutura({ message: "Failed to fetch" })).toBe(true);
  });

  /**
   * O caso que quase passou batido: o `AuthRetryableFetchError` do supabase-js
   * carrega `status: 0`, não `undefined`. Uma regra escrita como "sem status ou
   * >= 500" deixaria a REDE FORA — o motivo mais provável de tudo isto — ser
   * lida como "essa pessoa não tem sessão", e o gestor receberia um formulário
   * de login em vez do aviso de que o sistema está fora do ar.
   */
  it("é falha quando o erro traz status 0 (rede fora, no supabase-js)", () => {
    expect(
      ehFalhaDeInfraestrutura({ name: "AuthRetryableFetchError", status: 0 }),
    ).toBe(true);
  });

  it("é falha quando o servidor quebrou", () => {
    expect(ehFalhaDeInfraestrutura({ status: 500 })).toBe(true);
    expect(ehFalhaDeInfraestrutura({ status: 503 })).toBe(true);
  });

  /**
   * O caminho NORMAL de quem chega deslogado: o GoTrue responde, e a resposta é
   * "não há sessão". Chamar isso de queda faria toda visita anônima ler um
   * aviso de sistema fora do ar.
   */
  it("NÃO é falha quando simplesmente não há sessão", () => {
    expect(
      ehFalhaDeInfraestrutura({ name: "AuthSessionMissingError", status: 400 }),
    ).toBe(false);
    expect(ehFalhaDeInfraestrutura({ name: "AuthSessionMissingError" })).toBe(
      false,
    );
  });

  it("NÃO é falha quando o token foi recusado", () => {
    expect(ehFalhaDeInfraestrutura({ status: 401 })).toBe(false);
    expect(ehFalhaDeInfraestrutura({ status: 403 })).toBe(false);
  });

  it("NÃO é falha quando não há erro nenhum", () => {
    expect(ehFalhaDeInfraestrutura(null)).toBe(false);
  });
});
