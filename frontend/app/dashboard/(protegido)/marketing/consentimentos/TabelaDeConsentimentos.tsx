"use client";

import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { formatarDataHora } from "@/lib/painel/data";
import {
  identificarTitular,
  type Consentimento,
} from "@/lib/painel/marketing/consentimentos.logica";
import {
  CANAIS_DE_CONTATO,
  ESTADOS_DE_CONSENTIMENTO,
  rotuloDe,
  tomDe,
} from "@/lib/painel/marketing/vocabulario";

/**
 * A tabela do livro-razão de consentimentos.
 *
 * `"use client"` porque `Coluna.celula` é uma FUNÇÃO e função não atravessa a
 * fronteira Server→Client — o porquê inteiro está em `TabelaDeClientes.tsx`, e
 * `proibicoes.test.ts` tem a guarda estrutural.
 *
 * A TABELA NÃO ORDENA, e isso é honestidade e não esquecimento:
 * `GET /admin/consentimentos` ordena por `criado_em DESC` e não aceita
 * parâmetro de ordenação. A `<Tabela>` desta casa só desenha a seta quando
 * recebe `aoOrdenar`, justamente para um cabeçalho não prometer o que a tela
 * não cumpre.
 */

/**
 * A ORDEM CRONOLÓGICA DECRESCENTE É A LEITURA CERTA DESTA TABELA, e ela vem do
 * backend. Numa tabela append-only, a linha de cima é a que VALE hoje — e
 * ordenar por qualquer outra coisa (por titular, por canal) misturaria a
 * decisão vigente com decisões revogadas há meses, sem nada na tela dizendo
 * qual é qual.
 */
const COLUNAS: Coluna<Consentimento>[] = [
  {
    chave: "titular",
    rotulo: "Titular",
    // R23: identificador HUMANO na primeira coluna. `identificarTitular` devolve
    // o e-mail, ou o telefone, ou uma frase — nunca o UUID.
    celula: (linha) => identificarTitular(linha),
  },
  {
    chave: "canal",
    rotulo: "Canal",
    celula: (linha) => rotuloDe(CANAIS_DE_CONTATO, linha.canal),
  },
  {
    chave: "estado",
    rotulo: "Estado",
    celula: (linha) => (
      <Selo tom={tomDe(ESTADOS_DE_CONSENTIMENTO, linha.estado)}>
        {rotuloDe(ESTADOS_DE_CONSENTIMENTO, linha.estado)}
      </Selo>
    ),
  },
  {
    chave: "origem",
    rotulo: "Origem",
    /*
      A ORIGEM É A METADE DO REGISTRO QUE UM BOOLEANO PERDERIA, e por isso ela é
      coluna e não detalhe escondido: a pergunta que esta tabela responde é «com
      base em quê vocês me mandaram esta mensagem em março?», e a resposta é
      esta célula junto da data ao lado.
    */
    celula: (linha) => linha.origem,
  },
  {
    chave: "quando",
    rotulo: "Registrado em",
    // `dado` porque é data: monoespaçada com numeral tabular, comparável por
    // posição. E é dd/mm/aaaa em São Paulo (R31) — `formatarDataHora` cuida.
    dado: true,
    celula: (linha) => formatarDataHora(linha.criado_em),
  },
];

export function TabelaDeConsentimentos({ linhas }: { linhas: Consentimento[] }) {
  return (
    <Tabela
      legenda="Consentimentos registrados"
      colunas={COLUNAS}
      linhas={linhas}
      chaveDaLinha={(linha) => linha.id}
    />
  );
}
