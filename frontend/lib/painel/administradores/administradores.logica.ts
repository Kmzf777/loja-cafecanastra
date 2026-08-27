import { montarUrl } from "../filtros";

/**
 * A DECISÃO da tela de Administradores — sem React, sem fetch, sem DOM
 * (spec §2.8).
 *
 * A TELA QUE NUNCA EXISTIU. Até a Onda 4 não havia caminho de aplicação nenhum
 * para criar, listar ou remover administrador: a única escrita em
 * `canastra.admins` do repositório está no script de instalação, e promover um
 * segundo gestor exigia abrir `psql` EM PRODUÇÃO. Não é um recurso que faltava
 * — é a operação mais sensível da loja acontecendo fora de qualquer registro, e
 * com a senha do painel irrecuperável do outro lado. Ponto único de falha
 * operacional.
 *
 * O QUE ESTE MÓDULO DECIDE, e cada coisa tem um jeito próprio de falhar:
 *
 *   ehUltimoAdmin ....... avisar ANTES de tentar. O trigger `admins_nunca_zero`
 *                         (0002:118) impede no banco e o repositório traduz o
 *                         23001 numa frase — mas descobrir a regra pelo erro é
 *                         pior que ser avisado, porque quem clica em "Remover"
 *                         já decidiu remover.
 *   ehVoceMesmo ......... remover a si próprio é permitido pelo backend quando
 *                         há outro admin, e é a porta de saída mais rápida do
 *                         painel. A tela nomeia a consequência.
 *   frasesDaRemocao ..... R11/R12: o texto nomeia a PESSOA e a CONSEQUÊNCIA.
 *                         "Tem certeza?" não carrega informação e treina a
 *                         clicar em OK.
 *   candidatosAPromover . quem já é admin sai da lista de busca — 409 é uma
 *                         resposta pior que uma opção que não aparece.
 */

/** A rota desta tela, num lugar só — é base de URL e de comparação no teste. */
export const ROTA_DE_ADMINISTRADORES = "/dashboard/administradores";

/**
 * Os papéis, IGUAIS ao CHECK `admins_papel_valido` (0035).
 *
 * A descrição é o que a lista de papéis SIGNIFICA no desenho do backend
 * (`administradoresRepository.js`), e não o que o painel faz hoje —
 * `distinguePorPapel` abaixo é a nota de rodapé honesta sobre a diferença.
 *
 * A lista é comparada com o backend por `administradores.logica.test.ts`, lendo
 * o arquivo do disco: um papel inventado aqui vira 400 na cara do gestor, e um
 * papel novo lá vira uma opção que a tela não oferece.
 */
export const PAPEIS = [
  {
    valor: "dono",
    rotulo: "Dono",
    descricao: "Tudo, inclusive dinheiro e custo.",
  },
  {
    valor: "gerente",
    rotulo: "Gerente",
    descricao: "Catálogo, promoção e pedido.",
  },
  {
    valor: "operador",
    rotulo: "Operador",
    descricao: "Expedição, sem ver custo nem margem.",
  },
] as const satisfies ReadonlyArray<{
  valor: string;
  rotulo: string;
  descricao: string;
}>;

export type Papel = (typeof PAPEIS)[number]["valor"];

/** O padrão do `POST`, e o mesmo do backend (`papel = "dono"`). Escrito aqui
 *  para o formulário nascer com a opção marcada em vez de com o `<select>` no
 *  primeiro item por acaso. */
export const PAPEL_PADRAO: Papel = "dono";

/** Valor desconhecido devolve a si mesmo — a doutrina de `rotuloDoStatus`:
 *  esconder atrás de "Outro" faria um papel novo do backend sumir da tela sem
 *  ninguém notar. */
export function rotuloDoPapel(valor: string): string {
  return PAPEIS.find((p) => p.valor === valor)?.rotulo ?? valor;
}

/**
 * O PAINEL NÃO DISTINGUE PAPEL — hoje, e por escrito.
 *
 * `isAdmin` (backend/src/middleware/isAdmin.js) pergunta uma coisa só:
 * `req.user.ehAdmin === true`, que é um EXISTS em `canastra.admins`. Nenhuma
 * rota, nenhum layout e nenhuma tela olham a coluna `papel`. Ou seja: promover
 * alguém a "Operador" dá a essa pessoa exatamente o mesmo acesso de "Dono",
 * inclusive ao custo do produto e à remoção de outros administradores.
 *
 * A constante existe para a tela DIZER isso ao lado do campo. Um seletor de
 * papel sem essa frase é a pior espécie de mentira de interface — a que o
 * gestor só descobre quando o "operador" muda um preço. Quando a distinção
 * existir de verdade, esta constante vira `true` e a frase muda num lugar só.
 *
 * `administradores.logica.test.ts` confere a afirmação contra o middleware, no
 * disco: se `isAdmin` passar a olhar `papel`, o teste fica vermelho e obriga a
 * atualizar a frase — em vez de deixá-la desatualizada dizendo o contrário do
 * que o servidor faz.
 */
export const DISTINGUE_POR_PAPEL = false;

/** A linha que `GET /admin/administradores` devolve. `email` vem de um LEFT
 *  JOIN em `auth.users` e pode ser nulo (conta do GoTrue já apagada, cliente
 *  ainda em `canastra.clientes`). */
export type AdministradorDaLista = {
  user_id: string;
  papel: string;
  criado_em: string | null;
  nome: string | null;
  email: string | null;
};

export type RespostaDeAdministradores = { data: AdministradorDaLista[] };

/**
 * O identificador HUMANO — R23, "nunca UUID".
 *
 * Aqui ele vale mais que em qualquer outra tela: `canastra.admins` é uma tabela
 * de `user_id`, e um painel que mostrasse `dddddddd-0000-…` numa lista de "quem
 * pode mexer na loja" obrigaria a cruzar uuid com pessoa na mão — que é
 * exatamente o gesto que ninguém faz antes de clicar em remover. O backend já
 * faz o JOIN; a tela só não pode desperdiçá-lo.
 */
export function identificarAdmin(admin: {
  nome: string | null;
  email: string | null;
}): string {
  const nome = (admin.nome ?? "").trim();
  if (nome) return nome;
  const email = (admin.email ?? "").trim();
  if (email) return email;
  return "Sem identificação";
}

/** Texto que pode faltar, virado travessão — ausência declarada em vez de
 *  célula vazia, que é indistinguível de defeito de carregamento. */
export function textoOuTraco(valor: string | null | undefined): string {
  const texto = (valor ?? "").trim();
  return texto === "" ? "—" : texto;
}

/* ==========================================================================
 * REMOVER — as três perguntas antes do clique
 * ========================================================================== */

/**
 * É o último? Então a remoção nem se oferece.
 *
 * O trigger `admins_nunca_zero` (0002:118) recusa no banco com 23001, e o
 * repositório o traduz numa frase decente. Mas a regra tem de aparecer ANTES:
 * quem clicou em "Remover" já decidiu remover, e descobrir a regra pelo erro
 * transforma uma informação de desenho num obstáculo.
 *
 * A pergunta é sobre a LISTA, e não sobre a linha, porque é a lista que
 * responde "sobra alguém?".
 */
export function ehUltimoAdmin(admins: readonly unknown[]): boolean {
  return admins.length <= 1;
}

/** É a própria conta de quem está olhando? Comparação estrita de uuid — um
 *  `undefined` de cada lado não pode virar "sim". */
export function ehVoceMesmo(
  userId: string,
  userIdDaSessao: string | null | undefined,
): boolean {
  return Boolean(userId) && userId === userIdDaSessao;
}

/**
 * A FRASE DA CONFIRMAÇÃO — R11/R12, e ela nomeia a pessoa e a consequência.
 *
 * "Tem certeza?" não carrega informação e treina a clicar em OK; o que a
 * pessoa precisa ler é DE QUEM se está falando e O QUE acontece. As duas
 * consequências são diferentes o bastante para terem textos diferentes:
 *
 *   outra pessoa .... perde o painel. A CONTA DE CLIENTE CONTINUA — é o
 *                     contrário de `DELETE /auth/users/:id`, que apaga tudo, e
 *                     confundir os dois é a diferença entre tirar um crachá e
 *                     demitir. Dizer isso é o que impede o gestor de hesitar
 *                     num gesto reversível (basta promover de novo).
 *   você mesmo ...... perde o painel AGORA, e não há botão de voltar: a tela de
 *                     administradores é a única que promove, e depois de sair
 *                     dela ninguém a alcança. É a porta de saída mais rápida do
 *                     painel, e a única que o backend permite de bom grado.
 */
export function fraseDaRemocao(
  nome: string,
  souEu: boolean,
): { titulo: string; texto: string; confirmar: string } {
  if (souEu) {
    return {
      titulo: "Remover o seu próprio acesso",
      texto:
        `Você vai tirar de si mesmo (${nome}) o acesso ao painel. ` +
        "Assim que confirmar, esta tela deixa de abrir para você — e só outro " +
        "administrador pode devolver o acesso. A sua conta de cliente continua " +
        "existindo, com os pedidos e o histórico.",
      confirmar: "Remover o meu acesso",
    };
  }
  return {
    titulo: "Remover administrador",
    texto:
      `${nome} vai perder o acesso ao painel. A conta de cliente continua ` +
      "existindo, com os pedidos e o histórico — isto tira o crachá, não " +
      "apaga a pessoa. Para devolver o acesso, é só promover de novo.",
    confirmar: "Remover o acesso",
  };
}

/**
 * O AVISO QUE APARECE NO LUGAR DO BOTÃO quando não dá para remover.
 *
 * `null` quando dá — e aí a tela desenha o botão. Um botão desabilitado sem
 * explicação é a pior das três opções: parece defeito, e não diz o que fazer.
 */
export function motivoParaNaoRemover(admins: readonly unknown[]): string | null {
  if (!ehUltimoAdmin(admins)) return null;
  return (
    "É a única pessoa que administra a loja. Promova outro administrador " +
    "antes de remover este — sem administrador, ninguém abre o painel de novo."
  );
}

/* ==========================================================================
 * PROMOVER
 * ========================================================================== */

/**
 * A busca de quem promover — a MESMA rota da tela de Clientes.
 *
 * `GET /auth/users?q=` compara nome, e-mail, telefone e CPF. Dez por página
 * porque isto é um seletor dentro de um diálogo, não uma lista de trabalho:
 * quem promove sabe o nome da pessoa, e vinte linhas num diálogo empurram os
 * botões para fora da tela.
 *
 * A CONSULTA NÃO VAI PARA A URL DA TELA, e essa é a diferença desta busca para
 * a de Clientes. R2 quer o estado da lista na URL, com uma ressalva explícita:
 * **nunca colocar CPF, e-mail ou endereço na query string** — URL vai para o
 * histórico, para o `Referer`, para o log do proxy e para a captura de tela que
 * o gestor manda no grupo. Ali o que entra é o que a pessoa digitou numa lista
 * que ela quer de volta; aqui é um gesto de meio-caminho dentro de um diálogo,
 * e o texto digitado é justamente um e-mail ou um CPF. Fica no estado do
 * componente e morre com ele.
 */
export const POR_PAGINA_NA_BUSCA = 10;

export function consultaDeCandidatos(busca: string): string {
  return montarUrl("/auth/users", {
    q: busca.trim() || undefined,
    limit: POR_PAGINA_NA_BUSCA,
  });
}

/** O que a busca de clientes devolve — o mesmo contrato de `clientes.logica.ts`,
 *  recortado no que este seletor usa. */
export type CandidatoAAdmin = {
  user_id: string;
  name: string | null;
  email: string | null;
};

/**
 * Os candidatos, SEM quem já é administrador.
 *
 * O backend responde 409 "Esta pessoa já é administradora da loja." — uma boa
 * frase para uma pergunta que a tela não precisava fazer. Ela TEM a lista de
 * admins em mãos: filtrar aqui troca um erro por uma opção que simplesmente não
 * aparece, e é a diferença entre uma ferramenta e um formulário.
 *
 * O 409 continua valendo do outro lado, e continua sendo mostrado: entre
 * carregar esta lista e clicar em promover, outra pessoa pode ter promovido a
 * mesma. Filtrar aqui é conveniência; a autoridade é o servidor.
 */
export function candidatosAPromover(
  clientes: readonly CandidatoAAdmin[],
  admins: readonly { user_id: string }[],
): CandidatoAAdmin[] {
  const jaSao = new Set(admins.map((a) => a.user_id));
  return clientes.filter((c) => !jaSao.has(c.user_id));
}

/**
 * A frase do estado vazio da busca — e ela EXPLICA a regra em vez de acusar.
 *
 * "Promover exige que a pessoa já seja cliente" é a regra que o backend cobra
 * com 404 ("Cliente não encontrado nesta loja."), e ela existe por segurança:
 * a instância Supabase é COMPARTILHADA, e um uuid com conta em outro projeto da
 * VPS chegaria com forma perfeita. Mas o gestor não sabe disso, e "não
 * encontrado" o deixa com a impressão de que a busca está quebrada.
 *
 * Os dois vazios são diagnósticos opostos, como manda o R16 — e o segundo é o
 * que carrega a instrução do que fazer a seguir.
 */
export function vazioDaBusca(busca: string, todosJaSaoAdmin: boolean): string {
  if (todosJaSaoAdmin) {
    return "Quem casou com esta busca já administra a loja.";
  }
  if (!busca.trim()) {
    return "Digite o nome, o e-mail ou o CPF de quem já tem conta na loja.";
  }
  return (
    `Ninguém com conta na loja casa com "${busca.trim()}". ` +
    "Só dá para promover quem já é cliente: peça à pessoa para criar a conta " +
    "na loja primeiro, e ela aparece aqui."
  );
}

/**
 * O corpo do `POST /admin/administradores`.
 *
 * `userId` em camelCase porque é o que a rota lê primeiro (`req.body?.userId ??
 * req.body?.user_id`). Mandar os dois nomes "por garantia" esconderia uma
 * divergência de contrato no dia em que só um deles continuasse valendo.
 */
export function payloadDePromocao(
  userId: string,
  papel: string,
): { userId: string; papel: string } {
  return { userId, papel };
}
