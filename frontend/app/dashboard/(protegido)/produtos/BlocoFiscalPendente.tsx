import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA } from "@/components/painel/ui/estilos";

/**
 * O CADASTRO FISCAL — o bloco que diz, por escrito, o que esta tela ainda não
 * consegue fazer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE UM BLOCO DE TEXTO E NÃO ONZE CAMPOS.
 *
 * As colunas existem: a migração 0034 acrescentou NCM, CEST, origem, GTIN,
 * GTIN de embalagem, unidade, tipo de item, CFOP padrão, CSOSN, peso líquido,
 * peso bruto e o código do Bling, cada uma com CHECK de formato. O que NÃO
 * existe é o caminho até elas:
 *
 *   `COLUNAS_DO_CONTRATO` (dashboardRepository.js) tem catorze colunas e
 *   NENHUMA fiscal — então `GET /dashboard/:id` não as devolve. O `UPDATE` de
 *   `editProduct` escreve doze colunas e nenhuma fiscal — então `PUT` não as
 *   grava. E o PostgREST também não serve: 0034 deixou as colunas novas FORA de
 *   todo GRANT de propósito ("coluna nova acrescentada por ALTER TABLE não
 *   herda GRANT nenhum — ela nasce ilegível para `anon` e para
 *   `authenticated`"), então uma leitura por supabase-js levaria 42501.
 *
 * Desenhar os campos assim mesmo produziria o pior resultado possível: o gestor
 * preencheria o NCM de trinta cafés, salvaria, leria "Produto editado com
 * sucesso!" e o banco continuaria vazio. É literalmente o defeito que a
 * pesquisa cataloga como "botões que mentem" — e este bloco existe para não o
 * repetir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * E POR QUE ELE NÃO É SÓ UM "EM BREVE".
 *
 * Porque o modo de falha do campo fiscal vazio é o pior que existe, e está
 * escrito em 0034: **um produto sem NCM PASSA na sincronização, PASSA no
 * cadastro, PASSA na venda — e só falha na TRANSMISSÃO À SEFAZ, com o pedido do
 * cliente já pago e parado esperando nota.** O erro é criado meses antes de
 * aparecer, e aparece na única hora em que não dá para consertar com calma.
 *
 * A lista abaixo é, então, o que o contador precisa ter em mãos no dia em que
 * a rota existir — e a razão de ela estar aqui, e não num documento, é que é
 * aqui que se vai procurar.
 */

/** O que 0034 criou, na ordem em que a nota os pede. */
const CAMPOS_DA_NOTA: { nome: string; para: string }[] = [
  { nome: "NCM", para: "8 dígitos. Sem ele a SEFAZ recusa a transmissão." },
  { nome: "CEST", para: "7 dígitos, só para produto sujeito a substituição tributária." },
  { nome: "Origem", para: "0 a 8, tabela da SEFAZ. 0 é nacional." },
  { nome: "GTIN", para: 'Código de barras. Sem código, a norma exige a palavra "SEM GTIN".' },
  { nome: "GTIN da embalagem", para: "O código da caixa, quando difere do da unidade." },
  { nome: "Unidade", para: "Como o produto se conta: UN, KG, CX." },
  { nome: "Tipo do item", para: "Tabela 4.1.1 do SPED — 00 revenda, 04 produto acabado…" },
  { nome: "CFOP padrão", para: "4 dígitos. 5102 dentro do estado, 6102 fora." },
  { nome: "CSOSN / CST", para: "O código de tributação do ICMS deste produto." },
  { nome: "Peso líquido", para: "O peso do café, sem embalagem." },
  { nome: "Peso bruto", para: "Com embalagem. Nunca menor que o líquido." },
  { nome: "Código no Bling", para: "Hoje a ligação é por SKU: renomear lá desliga em silêncio." },
];

export function BlocoFiscalPendente() {
  return (
    <Ficha titulo="Cadastro fiscal da NF-e" nivel={3}>
      <div className="space-y-4">
        <Tarja tom="alerta">
          Estes campos existem no banco desde a migração 0034, mas a API do
          painel ainda não os lê nem os grava — não há como preenchê-los por
          aqui. Enquanto isso, a regra fiscal de cada café continua sendo
          escrita à mão dentro da conta Bling.
        </Tarja>

        <p className="max-w-[75ch] text-[13px] text-fuligem-55">
          Por que isso importa antes de ligar a nota automática: um produto sem
          NCM passa no cadastro, passa na sincronização e passa na venda — e só
          falha na transmissão à SEFAZ, com o pedido do cliente já pago e parado.
          O erro nasce meses antes de aparecer.
        </p>

        <div>
          <p className={`mb-2 text-[10px] ${ETIQUETA} text-fuligem-55`}>
            O que a nota vai exigir
          </p>
          {/*
            `<dl>` e não `<ul>`: são pares nome/explicação, e é isso que a lista
            de definição diz ao leitor de tela. Numa lista simples, os vinte e
            quatro pedaços de texto viriam sem relação nenhuma entre si.
          */}
          <dl className="divide-y divide-fuligem-20 border-y border-fuligem-20">
            {CAMPOS_DA_NOTA.map((campo) => (
              <div
                key={campo.nome}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2"
              >
                <dt className="w-40 shrink-0 text-[13px] font-medium">{campo.nome}</dt>
                <dd className="min-w-0 flex-1 text-[13px] text-fuligem-55">
                  {campo.para}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Ficha>
  );
}
