export type ItemDeMenu = { rotulo: string; href: string };
export type GrupoDeMenu = { titulo: string | null; itens: ItemDeMenu[] };

/**
 * O menu do painel, em PORTUGUÊS e com a rota em português.
 *
 * As rotas do painel legado eram `/dashboard/products/addProduct` — inglês
 * herdado do template de onde o projeto nasceu, numa loja cujo gestor não fala
 * inglês. A reescrita corrige isso, e a estrutura vive aqui e não dentro do
 * JSX porque é dado, não desenho: é sobre ela que o teste de item ativo roda.
 *
 * A ORDEM É A DO DIA DE TRABALHO, não a do organograma: primeiro o que se olha
 * toda manhã (a home, os pedidos), por último o que se mexe uma vez por mês
 * (ajustes).
 */
export const MENU: GrupoDeMenu[] = [
  { titulo: null, itens: [{ rotulo: "Início", href: "/dashboard" }] },
  {
    titulo: "Vender",
    itens: [
      { rotulo: "Pedidos", href: "/dashboard/pedidos" },
      { rotulo: "Assinaturas do Clube", href: "/dashboard/assinaturas" },
      { rotulo: "Descontos", href: "/dashboard/descontos" },
    ],
  },
  {
    titulo: "Catálogo",
    itens: [
      { rotulo: "Produtos", href: "/dashboard/produtos" },
      { rotulo: "Avaliações", href: "/dashboard/avaliacoes" },
    ],
  },
  {
    titulo: "Crescer",
    itens: [
      { rotulo: "Marketing", href: "/dashboard/marketing" },
      { rotulo: "Vitrine", href: "/dashboard/vitrine" },
      { rotulo: "Relatórios", href: "/dashboard/relatorios" },
    ],
  },
  {
    titulo: "Gerir",
    itens: [
      { rotulo: "Clientes", href: "/dashboard/clientes" },
      /*
        ADMINISTRADORES ENTROU AQUI PORQUE A TELA ESTAVA ÓRFÃ. Ela nasceu na
        Onda 4 e não havia link nenhum para ela em lugar nenhum do menu: o único
        caminho era um parágrafo dentro de `/dashboard/ajustes`. Uma tela que só
        se alcança por quem já sabe que ela existe é uma tela que não existe — e
        esta é a que impede a loja de perder a gestão quando alguém esquece a
        senha (que é irrecuperável).

        Ao lado de Clientes, e não em "Ajustes": as duas listam PESSOAS, e o que
        muda entre elas é de que lado do balcão. Ajustes é onde se mexe em
        configuração, uma vez por mês.
      */
      { rotulo: "Administradores", href: "/dashboard/administradores" },
      { rotulo: "Ajustes", href: "/dashboard/ajustes" },
    ],
  },
];

/**
 * Qual item está ativo, dado o caminho atual.
 *
 * `/dashboard` só casa EXATO — senão a home fica acesa em toda tela do painel,
 * porque toda rota começa com ela. Os demais casam por prefixo de segmento, de
 * modo que `/dashboard/pedidos/abc-123` mantenha "Pedidos" aceso. O corte por
 * segmento (`href + "/"`) e não por string evita que `/dashboard/produtos`
 * acenda para `/dashboard/produtos-arquivados`.
 */
export function itemAtivo(caminho: string): string | null {
  const itens = MENU.flatMap((g) => g.itens);
  if (caminho === "/dashboard") return "/dashboard";
  const casados = itens
    .filter((i) => i.href !== "/dashboard")
    .filter((i) => caminho === i.href || caminho.startsWith(i.href + "/"));
  if (!casados.length) return null;
  return casados.sort((a, b) => b.href.length - a.href.length)[0].href;
}

/**
 * O painel antigo, que continua de pé em `/dashboard/legado`.
 *
 * FICA FORA DO `MENU` DE PROPÓSITO. `MENU` é o mapa do painel NOVO — é sobre
 * ele que `itemAtivo` decide, e é ele que as ondas seguintes vão preencher.
 * O legado não é uma área do produto: é uma saída de emergência com data de
 * validade (a Onda 6 do roteiro apaga `frontend/legacy/` e esta constante
 * junto). Metê-lo no `MENU` faria a estrutura do painel novo mentir sobre o
 * seu próprio tamanho, e obrigaria a lembrar de tirá-lo de lá depois.
 *
 * Enquanto ele existe, PRECISA estar visível: nesta onda as telas novas ainda
 * não nasceram, e sem este link o gestor não tem como chegar ao único painel
 * que hoje faz o trabalho dele.
 */
export const LEGADO: ItemDeMenu = {
  rotulo: "Painel antigo",
  href: "/dashboard/legado",
};

/** O legado está aceso? Mesmo corte por segmento de `itemAtivo`, pelo mesmo
 *  motivo — `/dashboard/legado-de-teste` não é o painel antigo. */
export function legadoAtivo(caminho: string): boolean {
  return caminho === LEGADO.href || caminho.startsWith(LEGADO.href + "/");
}
