/**
 * A cerca do painel — quem entra em /dashboard, decidido NO SERVIDOR.
 *
 * O PROBLEMA QUE ISTO FECHA. Até aqui `/dashboard` não tinha barreira nenhuma:
 * a página era `"use client"`, montava a ilha legada com `ssr: false`, e quem
 * você é só era decidido DEPOIS de o navegador baixar o painel inteiro
 * (react-router, styled-components, recharts, os quatro provedores e as três
 * requisições que eles disparam antes de saber de quem são). Qualquer visitante
 * anônimo recebia o código do painel, sua estrutura e a superfície de API que
 * ele conhece. Os DADOS estavam protegidos — RLS no banco, `isAdmin` em cada
 * rota do Express —, mas o mapa da casa era público. Registrado em
 * `docs/producao.md` §1.1 como pendência da F6.
 *
 * COMO ESTÁ DIVIDIDO, E POR QUÊ. O Vitest deste projeto roda em ambiente `node`,
 * sem jsdom e sem runtime do Next: o que dá para testar de verdade é função
 * pura. Então a DECISÃO (`decidirAcessoAoPainel`, `destinoDoPainel`,
 * `ehFalhaDeInfraestrutura`) não toca em rede, cookie nem redirecionamento — ela
 * recebe fatos e devolve um veredito. A parte impura (`lerAcessoDoPainel`,
 * `exigirAdminNoPainel`) só colhe os fatos e obedece.
 *
 * ISTO É O PRIMEIRO ANEL, NÃO O ÚNICO. `legacy/routes/AdminRoutes.jsx` continua
 * conferindo no cliente, porque a sessão pode morrer com o painel já aberto —
 * nesse instante nenhum Server Component vai rodar de novo.
 *
 * O QUE ESTE MÓDULO NÃO É. Não é `middleware.ts`. O middleware segue sem guardar
 * rota pelo motivo documentado lá: `/account/verify-email` e
 * `/account/reset-password` recebem o `?code=` do GoTrue AINDA SEM SESSÃO, e um
 * guard global mandaria as duas para o login antes de o navegador trocar o
 * código pela sessão — quebrando confirmação de e-mail e recuperação de senha de
 * uma vez só. O guard do painel é local ao painel.
 */
import { redirect } from "next/navigation";
import { criarClienteServidor } from "../supabase/servidor";

/** Onde o painel começa. Uma constante porque três funções aqui dependem dela. */
const RAIZ_DO_PAINEL = "/dashboard";

/** A porta de entrada do painel — a única rota sob /dashboard fora da cerca. */
export const ROTA_DE_ENTRADA = "/dashboard/entrar";

/**
 * Por que a pessoa foi recusada. Não é enfeite: a tela de entrada diz coisas
 * diferentes para "faça login" e para "não conseguimos confirmar quem você é", e
 * casar TEXTO de mensagem para descobrir qual é dos dois é a fragilidade que
 * este projeto já pagou caro (ver a tabela de tradução em `sessao.ts`).
 */
export type MotivoDaRecusa = "sem-sessao" | "falha-de-consulta" | "nao-e-admin";

export type DecisaoDeAcesso =
  | { tipo: "entra" }
  | { tipo: "redireciona"; destino: string; motivo: MotivoDaRecusa };

export type FatosDoAcesso = {
  /** Há usuário autenticado nos cookies desta requisição. */
  temSessao: boolean;
  /** Há linha para ele em `canastra.admins`. */
  ehAdmin: boolean;
  /** Não deu para perguntar — rede, GoTrue ou PostgREST fora. */
  falhouConsulta: boolean;
  /** O caminho que ele tentou abrir, para voltar a ele depois de entrar. */
  rotaPedida: string;
};

/**
 * A decisão. Pura: nenhuma rede, nenhum cookie, nenhum `redirect()`.
 *
 * A ORDEM DAS PERGUNTAS É PARTE DA REGRA.
 *
 * 1. `falhouConsulta` vem primeiro, inclusive na frente de `temSessao`. Quando
 *    os dois coincidem — não deu para perguntar ao GoTrue —, a frase honesta é
 *    "não conseguimos confirmar", não "faça login": a segunda culpa a pessoa por
 *    um problema do servidor, e um gestor que lê "entre de novo" conclui que
 *    errou a senha e vai trocar uma senha que estava certa.
 *
 * 2. FALHA DE CONSULTA FECHA O ACESSO. É a mesma regra de `lerPapel()`
 *    (`lib/conta/sessao.ts:260-270`), e vale repetir o porquê: no pior caso um
 *    administrador de verdade recarrega a página. O inverso — assumir admin
 *    quando a consulta falhou — abriria a área de gestão por causa de uma queda
 *    de rede, que é exatamente o momento em que ninguém está olhando. Note que
 *    isto vale MESMO com `ehAdmin: true`: se a consulta falhou, o `true` não foi
 *    lido do banco, e um valor que ninguém confirmou não abre porta.
 *
 * 3. Sessão sem linha em `admins` NÃO é erro nem falha — é um cliente da loja
 *    que abriu o endereço do painel. Ele vai para a própria conta, onde o aviso
 *    explica; jogá-lo no formulário de login seria pedir que digitasse de novo a
 *    senha que já funcionou.
 */
export function decidirAcessoAoPainel(fatos: FatosDoAcesso): DecisaoDeAcesso {
  const de = `de=${encodeURIComponent(fatos.rotaPedida)}`;

  if (fatos.falhouConsulta) {
    return {
      tipo: "redireciona",
      // O aviso viaja na URL porque `motivo` sozinho morre dentro do processo,
      // e quem precisa da informação é o gestor na frente da tela.
      destino: `${ROTA_DE_ENTRADA}?${de}&aviso=falha`,
      motivo: "falha-de-consulta",
    };
  }

  if (!fatos.temSessao) {
    return {
      tipo: "redireciona",
      destino: `${ROTA_DE_ENTRADA}?${de}`,
      motivo: "sem-sessao",
    };
  }

  if (!fatos.ehAdmin) {
    return {
      tipo: "redireciona",
      destino: "/account?painel=negado",
      motivo: "nao-e-admin",
    };
  }

  return { tipo: "entra" };
}

/**
 * Valida o `?de=` da tela de entrada do painel. Pura.
 *
 * Herda a disciplina de `destinoSeguro()` (`sessao.ts`) — parâmetro de URL nunca
 * vira destino direto, senão `?de=https://site-falso/` manda a pessoa para fora
 * logo depois de ela digitar a senha, com a credibilidade do domínio verdadeiro
 * emprestada ao golpe. Aqui isso é pior que na loja: a senha em questão é a do
 * GESTOR.
 *
 * E ACRESCENTA UMA TRAVA: mesmo caminho interno só passa se estiver SOB
 * `/dashboard`. O login do painel não serve de trampolim para lugar nenhum —
 * quem chegou aqui pediu o painel, e é ao painel que volta.
 *
 * POR QUE A VALIDAÇÃO É POR `new URL`, E NÃO POR CASAMENTO DE PREFIXO. A versão
 * anterior recusava travessia com `bruto.includes("..")`, e a revisão de
 * segurança provou o furo ao vivo: `%2e%2e` é o mesmo segmento `..` escrito de
 * outro jeito, e passava inteiro. `?de=/dashboard/%2e%2e/account` saía daqui
 * aprovado e o NAVEGADOR normalizava para `/account` — a trava vazando por
 * normalização de caminho, sem um caractere suspeito à vista.
 *
 * A lição é que comparar TEXTO de URL é sempre perder: para cada grafia que se
 * proíbe existe outra que significa a mesma coisa. Então quem normaliza aqui é o
 * mesmo parser que o navegador usa. Uma passada de `new URL` resolve de uma vez
 * `..`, `%2e%2e`, `.%2e`, contrabarra, `//evil`, absolutas e caracteres de
 * controle (inclusive `%0A`, que num `Location:` viraria injeção de cabeçalho).
 * Depois disso só resta comparar um caminho JÁ NORMALIZADO, que é uma pergunta
 * com resposta única.
 *
 * A base é um host inventado e inalcançável: ele nunca vai para lugar nenhum,
 * serve só para dar ao parser um lugar de onde resolver caminho relativo.
 * Qualquer coisa que escape dele — absoluta, protocol-relative, `/\` — muda a
 * origem, e a comparação de origem pega todas de uma vez.
 *
 * A COMPARAÇÃO DE CAMINHO É SENSÍVEL A CAIXA de propósito: caminho de URL é, e
 * `/DASHBOARD` não é uma rota deste projeto.
 *
 * O tipo aceita lista porque `searchParams` do Next entrega `string[]` quando o
 * parâmetro vem repetido (`?de=/dashboard&de=https://evil.com`); ambiguidade
 * assim cai no padrão em vez de escolher uma das duas.
 */
const BASE_INTERNA = "http://interno.invalido";

export function destinoDoPainel(
  bruto: string | string[] | null | undefined,
): string {
  if (typeof bruto !== "string" || !bruto) return RAIZ_DO_PAINEL;

  let url: URL;
  try {
    url = new URL(bruto, BASE_INTERNA);
  } catch {
    // Percent-encoding quebrado, host impossível: o que o parser não lê, a
    // gente não obedece.
    return RAIZ_DO_PAINEL;
  }

  // Saiu da base inventada => era absoluta, `//evil.com` ou `/\evil.com`.
  if (url.origin !== BASE_INTERNA) return RAIZ_DO_PAINEL;

  // A partir daqui `pathname` já está normalizado: sem `..`, sem `%2e%2e`, sem
  // contrabarra, sem caractere de controle.
  const caminho = url.pathname;

  const sobOPainel =
    caminho === RAIZ_DO_PAINEL || caminho.startsWith(`${RAIZ_DO_PAINEL}/`);
  if (!sobOPainel) return RAIZ_DO_PAINEL;

  // A porta de entrada não pode ser destino de si mesma: `?de=/dashboard/entrar`
  // devolveria a pessoa ao formulário logo depois de ela entrar, e o vaivém
  // parece "o login não funcionou". Vale para a rota e para o que estiver
  // abaixo dela — `/dashboard/entrar/foo` não é rota de roteador nenhum.
  const ehAPortaDeEntrada =
    caminho === ROTA_DE_ENTRADA || caminho.startsWith(`${ROTA_DE_ENTRADA}/`);
  if (ehAPortaDeEntrada) return RAIZ_DO_PAINEL;

  return `${caminho}${url.search}${url.hash}`;
}

/** O formato mínimo de erro que interessa aqui — GoTrue e PostgREST cabem nele. */
type ErroDeConsulta = {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
};

/**
 * "O servidor caiu" × "o servidor respondeu que não". Pura.
 *
 * ISTO EXISTE PARA NÃO MENTIR PARA O ANÔNIMO. `getUser()` sem sessão devolve
 * ERRO (`AuthSessionMissingError`), e esse é o caminho normal de quem chega
 * deslogado. Contar esse erro como queda faria toda visita anônima ler um aviso
 * de sistema fora do ar — e no dia da queda de verdade ninguém acreditaria nele.
 *
 * O critério é a CLASSE do erro, nunca o texto, e a regra é escrita pelo lado
 * ESTREITO: só um `4xx` conta como "o servidor respondeu que não" — resposta
 * legítima de um servidor vivo dizendo que a sessão não vale, o que é uma
 * informação. Todo o resto é falha.
 *
 * POR QUE NÃO "sem status ou >= 500", QUE ERA O ÓBVIO: o
 * `AuthRetryableFetchError` do supabase-js — o erro de REDE FORA, o motivo mais
 * provável de tudo isto — carrega `status: 0`, não `undefined`. Aquela regra o
 * classificaria como "não tem sessão", e o gestor receberia um formulário de
 * login em vez do aviso de que o sistema está fora do ar. Enumerar o que é falha
 * exige acertar a lista inteira; enumerar o que NÃO é exige acertar um caso só.
 */
export function ehFalhaDeInfraestrutura(
  erro: ErroDeConsulta | null | undefined,
): boolean {
  if (!erro) return false;
  if (erro.name === "AuthSessionMissingError") return false;
  const respondeuQueNao =
    typeof erro.status === "number" && erro.status >= 400 && erro.status < 500;
  return !respondeuQueNao;
}

export type AcessoDoPainel = {
  temSessao: boolean;
  ehAdmin: boolean;
  falhouConsulta: boolean;
  /** Para a tela de entrada dizer QUAL conta está logada quando ela não serve. */
  email: string | null;
};

/**
 * Colhe os fatos no servidor. A única ida à rede deste módulo.
 *
 * UMA LEITURA SÓ, USADA PELOS DOIS LADOS — o guard (`exigirAdminNoPainel`) e a
 * página de entrada. Duas cópias da pergunta "essa pessoa é gestora?" é como as
 * duas telas passam a discordar: o guard recusaria e a entrada diria que já está
 * tudo certo, e a pessoa ficaria presa no vaivém.
 *
 * `getUser()` e NÃO `getSession()`: aqui não precisamos do access token, e
 * `getUser()` confere o token COM O GoTrue em vez de confiar no cookie. Num
 * Server Component, onde a decisão de mostrar ou não o painel é tomada, essa
 * diferença é a que importa.
 *
 * O PAPEL VEM DA TABELA, NUNCA DO JWT — a decisão mais importante de
 * `sessao.ts:229-248`, repetida aqui porque este é outro caminho até a mesma
 * porta. A instância do Supabase é COMPARTILHADA com outros projetos, e
 * `user_metadata` é editável pelo próprio dono da conta: um `{"role":"admin"}`
 * ali seria administrador autoatribuído. `canastra.admins` só é escrita por
 * `service_role`.
 *
 * O `catch` largo do fim cobre o que nenhum dos dois `error` cobre: env faltando
 * (`ambiente.ts` lança com o nome da variável) e exceção de rede. Ele fecha o
 * acesso em vez de derrubar a página, e NÃO engole `redirect()` — a chamada de
 * `redirect` está fora dele, em `exigirAdminNoPainel`, justamente porque o Next
 * a implementa lançando uma exceção de controle.
 */
export async function lerAcessoDoPainel(): Promise<AcessoDoPainel> {
  try {
    const supabase = await criarClienteServidor();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      const falhou = ehFalhaDeInfraestrutura(error);
      if (falhou) {
        console.warn(
          "[painel] Não foi possível confirmar a sessão no GoTrue; fechando o " +
            `acesso. ${error?.status ?? "(sem status)"} ${error?.message ?? ""}`.trim(),
        );
      }
      return {
        temSessao: false,
        ehAdmin: false,
        falhouConsulta: falhou,
        email: null,
      };
    }

    const email = data.user.email ?? null;
    const consulta = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle();

    if (consulta.error) {
      console.warn(
        "[painel] Não foi possível conferir canastra.admins; fechando o " +
          `acesso. ${consulta.error.code ?? ""} ${consulta.error.message ?? ""}`.trim(),
      );
      return { temSessao: true, ehAdmin: false, falhouConsulta: true, email };
    }

    return {
      temSessao: true,
      ehAdmin: Boolean(consulta.data),
      falhouConsulta: false,
      email,
    };
  } catch (erro) {
    /**
     * O Next sinaliza CONTROLE DE FLUXO lançando, e não só erro: quando um
     * Server Component lê algo dinâmico (cookie, cabeçalho) durante uma
     * prerenderização, ele lança um `DYNAMIC_SERVER_USAGE` para dizer "esta
     * rota não pode ser estática". Engolir isso aqui transformaria um recado
     * interno do framework em "falhou a consulta", e a rota seria prerenderizada
     * como se ninguém estivesse logado — o painel viraria uma página estática
     * dizendo que você não tem acesso, servida a todo mundo do cache.
     *
     * Hoje o projeto não liga `cacheComponents`, então isto não acontece. O
     * rethrow é para o dia em que ligar: sem ele a falha não daria erro, daria
     * uma página errada em cache, que é a categoria de bug que ninguém acha.
     */
    if (ehSinalDoNext(erro)) throw erro;

    console.warn("[painel] Falha ao avaliar o acesso ao painel.", erro);
    return {
      temSessao: false,
      ehAdmin: false,
      falhouConsulta: true,
      email: null,
    };
  }
}

/**
 * `true` quando o "erro" é, na verdade, o Next conduzindo o render.
 *
 * `digest` é o campo que o Next carimba nessas exceções de controle. `redirect()`
 * e `notFound()` também usam o mesmo mecanismo (`NEXT_REDIRECT`, `NEXT_HTTP_ERROR_FALLBACK`) —
 * nenhum dos dois é lançado dentro do `try` desta função, mas a checagem é
 * escrita por prefixo de família para continuar valendo se um dia for.
 */
function ehSinalDoNext(erro: unknown): boolean {
  const digest = (erro as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return false;
  return (
    digest.startsWith("DYNAMIC_SERVER_USAGE") ||
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  );
}

/**
 * O guard. Chamado no topo do Server Component do painel, ANTES de qualquer
 * byte da ilha ser emitido.
 *
 * Não devolve nada porque só há dois desfechos: ou volta (e quem chamou pode
 * renderizar), ou `redirect()` lança e a renderização nem acontece.
 */
export async function exigirAdminNoPainel(rotaPedida: string): Promise<void> {
  const acesso = await lerAcessoDoPainel();
  const decisao = decidirAcessoAoPainel({ ...acesso, rotaPedida });
  if (decisao.tipo === "redireciona") redirect(decisao.destino);
}

/**
 * A ROTA PEDIDA NÃO É RECUPERÁVEL NO SERVIDOR, e este comentário existe no lugar
 * da função que tentava recuperá-la.
 *
 * Houve aqui uma `rotaPedidaDoPainel()` que lia o cabeçalho `Next-Url` para
 * montar um `?de=` preciso, com um comentário dizendo que funcionava "quando o
 * cabeçalho vier". Ele NUNCA vem, e o ramo era código morto prometendo o que não
 * entregava — pior que a ausência, porque ensinava errado quem fosse mexer
 * depois.
 *
 * A PROVA, para ninguém tentar de novo: `next/dist/server/base-server.js`, em
 * `setVaryHeader`, faz `delete req.headers[NEXT_URL]` sempre que
 * `pathCouldBeIntercepted(resolvedPathname)` for falso — e isso só é verdade
 * havendo rota de interceptação (`(.)`, `(..)`, `(...)`). Este projeto não tem
 * nenhuma, então o cabeçalho é apagado em 100% das requisições, antes de
 * qualquer Server Component rodar. Medido também na prática: requisição de RSC
 * com `Next-Url: /dashboard/orders` produz exatamente o mesmo `?de=%2Fdashboard`
 * do controle sem cabeçalho.
 *
 * ENTÃO O `?de=` DO GUARD DE SERVIDOR É SEMPRE A RAIZ DO PAINEL. Um layout não
 * recebe os `params` do catch-all abaixo dele, não há cabeçalho de caminho, e
 * `middleware.ts` está fora deste trabalho por decisão de desenho (ele não
 * guarda rota porque `/account/verify-email` e `/account/reset-password` recebem
 * o `?code=` do GoTrue ainda sem sessão).
 *
 * A ROTA EXATA SOBREVIVE POR OUTRO CAMINHO: `legacy/routes/AdminRoutes.jsx`, no
 * cliente, enxerga `location.pathname + location.search` e manda o `?de=`
 * completo. É o caso da sessão que morre com o painel já aberto — justamente o
 * caso em que a pessoa estava no meio de alguma coisa e voltar ao lugar certo
 * importa. Quem chega por favorito frio volta para `/dashboard` e navega dali.
 */
