import { Ficha } from "@/components/painel/ui/Ficha";
import { ETIQUETA } from "@/components/painel/ui/estilos";

/**
 * O que a área de Marketing NÃO tem, e por quê — na tela, não num documento.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO É UMA FICHA E NÃO UM ITEM DE MENU.
 *
 * Newsletter, carrinho abandonado e automações foram pedidos, e nenhum dos três
 * tem rota no Express. As tabelas existem no banco (0033 criou `automacoes`;
 * `newsletter_inscritos` vem de 0011 e está enchendo; o job de abandono roda e
 * grava `lembrete_enviado_em`) — o que não existe é caminho de leitura para o
 * painel.
 *
 * Havia três saídas, e duas são piores:
 *
 *   TELA VAZIA COM "EM BREVE" — um link do menu que leva a uma tela que não faz
 *   nada ensina que os controles deste painel podem não levar a lugar nenhum. É
 *   o custo mais caro e o mais invisível: depois disso, todo botão é suspeito.
 *
 *   SILÊNCIO — o gestor procura a newsletter, não acha, e abre chamado. E a
 *   próxima onda não tem como saber que a lacuna foi notada.
 *
 *   ESTA FICHA — as três aparecem nomeadas, com o que existe do lado do banco,
 *   o que falta do lado da API, e o que fazer enquanto isso. É R28 ("latência
 *   declarada mata metade dos chamados") aplicado a funcionalidade em vez de a
 *   dado, e é também a lista de tarefas da onda seguinte.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Lacuna = {
  titulo: string;
  existe: string;
  falta: string;
  enquantoIsso: string;
};

const LACUNAS: Lacuna[] = [
  {
    titulo: "Newsletter — quem assinou, de onde veio, exportar",
    existe:
      "`canastra.newsletter_inscritos` está enchendo desde a migração 0011, com e-mail, origem e data. A 0033 acrescentou `optout_em`, `token_descadastro` e `confirmado_em`.",
    falta:
      "Não há rota de leitura para o painel: `/newsletter` só tem os dois POST públicos (inscrever e descadastrar), sem nenhum GET de admin. A exportação pedida — que grava no `admin_log` quem exportou e quando, como a de pedidos já faz — depende dessa rota existir primeiro.",
    enquantoIsso:
      "A lista só é alcançável por consulta direta ao banco. Nada se perde: os inscritos continuam entrando.",
  },
  {
    titulo: "Carrinho abandonado — quem, quanto, se voltou",
    existe:
      "O job `backend/src/jobs/carrinhoAbandonado.js` roda, encontra os carrinhos parados e grava `lembrete_enviado_em` para não repetir o aviso. A 0033 criou `carrinhos.token_retomada`, que é o que faz o link do e-mail devolver a pessoa ao carrinho cheio.",
    falta:
      "Nenhuma rota lista carrinhos abandonados, e por isso não há como mostrar quem, de quanto era a sacola, o que o job enviou nem se a pessoa voltou. O envio manual pedido depende da mesma rota.",
    enquantoIsso:
      "O lembrete automático continua saindo — o que falta é a visibilidade, não o envio.",
  },
  {
    titulo: "Automações — ligar e desligar cada gatilho",
    existe:
      "A tabela `canastra.automacoes` existe desde a 0033, com os oito gatilhos fechados por CHECK (carrinho abandonado, pedido aprovado/enviado/entregue, cliente novo, newsletter confirmada, assinatura criada/cancelada), espera em minutos, condição e ação em jsonb, e a coluna `ativa`.",
    falta:
      "Não há CRUD de `automacoes` no Express — nem listagem, nem PATCH. Um interruptor por gatilho é uma tela pequena, e ela só espera a rota.",
    enquantoIsso:
      "O único gatilho que roda de verdade hoje é o de carrinho abandonado, e ele é o job, não uma linha desta tabela.",
  },
];

export function LacunasDeMarketing() {
  return (
    <Ficha titulo="O que ainda não tem tela, e por quê">
      <p className="max-w-[75ch] text-[13px] text-fuligem-55">
        Três coisas pedidas para esta área ainda não podem ser desenhadas: o
        banco já guarda os dados, mas a API não tem rota que os entregue ao
        painel. Elas estão listadas aqui — com o que falta em cada uma — em vez
        de virarem telas vazias que parecem quebradas.
      </p>

      <ul className="mt-5 space-y-5">
        {LACUNAS.map((lacuna) => (
          <li
            key={lacuna.titulo}
            /* O filete à ESQUERDA, como na <Tarja>: marca o bloco sem desenhar
               uma segunda caixa dentro da <Ficha>, que já tem a sua. */
            className="border-l-2 border-fuligem-20 pl-4"
          >
            <h3 className="font-medium">{lacuna.titulo}</h3>
            <dl className="mt-2 space-y-2 text-[13px]">
              {(
                [
                  ["Já existe", lacuna.existe],
                  ["Falta", lacuna.falta],
                  ["Enquanto isso", lacuna.enquantoIsso],
                ] as const
              ).map(([rotulo, texto]) => (
                <div key={rotulo} className="sm:flex sm:gap-3">
                  <dt
                    className={`text-[10px] ${ETIQUETA} text-fuligem-55 sm:w-28 sm:shrink-0 sm:pt-[3px]`}
                  >
                    {rotulo}
                  </dt>
                  <dd className="max-w-[70ch] text-fuligem-55">{texto}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </Ficha>
  );
}
