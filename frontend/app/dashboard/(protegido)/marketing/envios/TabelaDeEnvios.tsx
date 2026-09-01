"use client";

import { Selo } from "@/components/painel/ui/Selo";
import { Tabela, type Coluna } from "@/components/painel/ui/Tabela";
import { formatarDataHora } from "@/lib/painel/data";
import { ondeParou, type Envio } from "@/lib/painel/marketing/envios.logica";
import {
  CANAIS_DE_CONTATO,
  ESTADOS_DE_ENVIO,
  rotuloDe,
  tomDe,
} from "@/lib/painel/marketing/vocabulario";

/**
 * A tabela do log de envios.
 *
 * `"use client"` porque `Coluna.celula` é FUNÇÃO — o porquê inteiro está em
 * `TabelaDeClientes.tsx`, e `proibicoes.test.ts` guarda a regra.
 *
 * NÃO ORDENA: `GET /admin/envios` ordena por `criado_em DESC` e não aceita
 * parâmetro de ordenação. Um cabeçalho clicável que não ordena é pior que um
 * cabeçalho quieto.
 */
const COLUNAS: Coluna<Envio>[] = [
  {
    chave: "destinatario",
    rotulo: "Destinatário",
    // R23: o identificador humano desta tabela é para ONDE a mensagem foi —
    // nunca o uuid do envio nem o do titular.
    celula: (linha) => linha.destinatario_final,
  },
  {
    chave: "canal",
    rotulo: "Canal",
    celula: (linha) => rotuloDe(CANAIS_DE_CONTATO, linha.canal),
  },
  {
    chave: "template",
    rotulo: "Mensagem",
    celula: (linha) =>
      linha.template ?? <span className="text-fuligem-55">—</span>,
  },
  {
    chave: "estado",
    rotulo: "Estado",
    celula: (linha) => (
      <Selo tom={tomDe(ESTADOS_DE_ENVIO, linha.estado)}>
        {rotuloDe(ESTADOS_DE_ENVIO, linha.estado)}
      </Selo>
    ),
  },
  {
    chave: "ondeParou",
    rotulo: "O que aconteceu",
    /*
      ESTA É A COLUNA QUE FAZ A TELA VALER. Quando o estado é `falhou`, ela
      mostra a frase do PROVEDOR ("mailbox full", "número inexistente") em vez do
      rótulo genérico — e é essa frase que diz se o conserto é apagar um contato
      ou refazer o cadastro. O CHECK `envios_erro_so_em_falha` (0033) garante que
      o texto só existe na falha, então quando ele aparece é sempre explicação.
    */
    /*
      O VERMELHO SEGUE O `tom` DO VOCABULÁRIO, e não uma segunda condição
      escrita aqui. `tomDe(...) === "erro"` é a MESMA fonte que pinta o <Selo> da
      coluna ao lado: com duas condições independentes, um estado novo do
      backend ganharia selo de erro e texto preto — ou o contrário —, e ninguém
      compara duas células da mesma linha procurando divergência de cor.

      E é o único vermelho desta tela, porque `falhou` é o único estado que É um
      erro. R21: no painel o vermelho não é destaque, é diagnóstico.
    */
    celula: (linha) => {
      const ehErro = tomDe(ESTADOS_DE_ENVIO, linha.estado) === "erro";
      return (
        <span className={ehErro ? "text-vermelho" : undefined}>
          {ondeParou(linha)}
        </span>
      );
    },
  },
  {
    chave: "quando",
    rotulo: "Quando",
    dado: true,
    /*
      O INSTANTE MAIS RECENTE QUE EXISTE, e não sempre `criado_em`: numa linha
      entregue, "quando" é a entrega; numa que só saiu, é o envio; numa que está
      na fila, é a criação. Mostrar sempre a criação faria uma mensagem entregue
      há cinco minutos parecer de ontem, que é quando ela entrou na fila.
    */
    celula: (linha) =>
      formatarDataHora(linha.entregue_em ?? linha.enviado_em ?? linha.criado_em),
  },
];

export function TabelaDeEnvios({ linhas }: { linhas: Envio[] }) {
  return (
    <Tabela
      legenda="Mensagens enviadas"
      colunas={COLUNAS}
      linhas={linhas}
      chaveDaLinha={(linha) => linha.id}
    />
  );
}
