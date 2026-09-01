import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { ChipsDeFiltro } from "@/components/painel/ui/ChipsDeFiltro";
import { EstadoDaTela } from "@/components/painel/ui/EstadoDaTela";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Paginacao } from "@/components/painel/ui/Paginacao";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { totalDePaginas } from "@/lib/painel/paginacao";
import {
  POR_PAGINA,
  ROTA_DE_CONSENTIMENTOS,
  chipsDosConsentimentos,
  lerEstado,
  montarConsulta,
  temFiltro,
  urlDaTela,
  type EstadoDosConsentimentos,
  type RespostaDeConsentimentos,
} from "@/lib/painel/marketing/consentimentos.logica";
import {
  CANAIS_DE_CONTATO,
  ESTADOS_DE_CONSENTIMENTO,
} from "@/lib/painel/marketing/vocabulario";

import { SubNavegacao } from "../SubNavegacao";
import { RegistroDeConsentimento } from "./RegistroDeConsentimento";
import { TabelaDeConsentimentos } from "./TabelaDeConsentimentos";

/**
 * `/dashboard/marketing/consentimentos` — o livro-razão da autorização.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA É, E O QUE ELA NÃO É.
 *
 * NÃO é um cadastro de preferências. É um HISTÓRICO append-only: o Express não
 * tem PATCH nem DELETE de consentimento, e a ausência é a decisão. A pergunta
 * que a tabela responde é «com base em quê vocês me mandaram esta mensagem em
 * março?», e editar a linha antiga apagaria a prova do que valia antes —
 * exatamente o que a prestação de contas da LGPD exige guardar.
 *
 * Revogar, então, é REGISTRAR UMA LINHA NOVA. A tela desenha isso literalmente:
 * o formulário se chama «Registrar consentimento» e tem «A pessoa: concedeu /
 * revogou», em vez de um interruptor por titular que sugeriria estado editável.
 *
 * E É DAQUI QUE SAI O PÚBLICO DE WHATSAPP. Ninguém entra num disparo sem uma
 * linha vigente nesta tabela — a redução do histórico ao estado de hoje mora em
 * `estadoAtualPorTitular`, com teste exaustivo, porque ler `estado=concedido`
 * cru do backend incluiria quem concedeu em janeiro e revogou em março.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const metadata: Metadata = {
  title: "Consentimentos",
  robots: { index: false, follow: false },
};

export default async function PaginaDeConsentimentos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [acesso, parametros] = await Promise.all([
    lerAcessoDoPainel(),
    searchParams,
  ]);

  const pedido = lerEstado(parametros);
  const resposta = await lerDaApi<RespostaDeConsentimentos>(montarConsulta(pedido));

  const dados = resposta.ok ? resposta.dados : null;
  const linhas = dados?.data ?? [];
  const total = dados?.total ?? 0;
  const estado = { ...pedido, pagina: dados?.page ?? pedido.pagina };

  return (
    <>
      <Cabecalho
        titulo="Consentimentos"
        descricao="Quem autorizou receber mensagem, por qual canal, com base em quê e quando."
        email={acesso.email}
      />

      <div className="mx-auto max-w-[1200px] space-y-4 px-5 py-6">
        <SubNavegacao ativa="consentimentos" />

        <Ficha titulo="Como esta tabela funciona">
          <div className="max-w-[75ch] space-y-3 text-[13px] text-fuligem-55">
            <p>
              Cada linha é um registro, e{" "}
              <strong className="text-fuligem">nada aqui é editado ou apagado</strong>
              . Quando alguém revoga, entra uma linha nova dizendo «revogado» — a
              antiga fica, porque é ela que prova o que valia antes.
            </p>
            <p>
              <strong className="text-fuligem">
                A linha mais recente de cada pessoa, em cada canal, é a que vale
                hoje.
              </strong>{" "}
              É por ela que o público de WhatsApp é montado: quem concedeu em
              janeiro e revogou em março fica de fora, mesmo tendo uma linha
              «concedido» nesta lista.
            </p>
            <p>
              A LGPD trata consentimento como estado com procedência, e não como
              um sim/não: por isso a coluna <strong>Origem</strong> é obrigatória
              e aparece ao lado da data.
            </p>
          </div>
        </Ficha>

        {/*
          OS FILTROS SÃO LINKS, e por isso esta tela não paga uma ilha de cliente
          por eles. Não há caixa de busca: o backend filtra por canal, estado e
          E-MAIL — e o e-mail não pode entrar na URL (ver `consentimentos.logica`
          e o painel de consulta logo abaixo).
        */}
        <div className="space-y-3">
          <FiltroEmLinha
            titulo="Canal"
            estado={estado}
            campo="canal"
            opcoes={CANAIS_DE_CONTATO}
          />
          <FiltroEmLinha
            titulo="Estado"
            estado={estado}
            campo="estado"
            opcoes={ESTADOS_DE_CONSENTIMENTO}
          />
        </div>

        <ChipsDeFiltro
          chips={chipsDosConsentimentos(estado)}
          hrefLimpar={ROTA_DE_CONSENTIMENTOS}
        />

        <EstadoDaTela
          carregando={false}
          esqueleto={null}
          erro={resposta.ok ? null : resposta.erro}
          /* ZERO É PLAUSÍVEL: `vazio` só é verdadeiro quando a leitura DEU
             CERTO. "Nenhum consentimento" por causa de uma API fora do ar é a
             pior leitura possível numa tela de conformidade. */
          vazio={resposta.ok && linhas.length === 0}
          filtroAtivo={temFiltro(estado)}
          vazioTitulo="Nenhum consentimento registrado"
          vazioTexto="Enquanto esta tabela estiver vazia, nenhum público de WhatsApp pode ser montado."
        >
          <Ficha semPreenchimento>
            <TabelaDeConsentimentos linhas={linhas} />
            <Paginacao
              pagina={estado.pagina}
              totalPaginas={dados?.totalPages ?? totalDePaginas(total, POR_PAGINA)}
              porPagina={POR_PAGINA}
              total={total}
              href={(pagina) => urlDaTela({ ...estado, pagina })}
              rotuloDoItem={{ singular: "registro", plural: "registros" }}
            />
          </Ficha>
        </EstadoDaTela>

        <RegistroDeConsentimento />
      </div>
    </>
  );
}

/**
 * Uma linha de filtro — o rótulo e as opções como links.
 *
 * O "Todos" é a primeira opção e não um botão de limpar à parte: numa fila de
 * três a cinco valores, "Todos" é um valor como os outros, e separá-lo obrigaria
 * a procurar em dois lugares como se desfaz o filtro.
 */
function FiltroEmLinha({
  titulo,
  estado,
  campo,
  opcoes,
}: {
  titulo: string;
  estado: EstadoDosConsentimentos;
  campo: "canal" | "estado";
  opcoes: ReadonlyArray<{ valor: string; rotulo: string }>;
}) {
  const todos = [{ valor: "", rotulo: "Todos" }, ...opcoes];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`w-16 text-[10px] ${ETIQUETA} text-fuligem-55`}>{titulo}</span>
      {todos.map((opcao) => {
        const aceso = estado[campo] === opcao.valor;
        // Mudar de filtro volta para a página 1: quem está na 4 e troca o filtro
        // cairia numa página 4 que pode não existir, e leria "nenhum resultado"
        // logo depois de ter FILTRADO.
        const href = urlDaTela({ ...estado, [campo]: opcao.valor, pagina: 1 });

        return aceso ? (
          <span
            key={opcao.valor || "todos"}
            aria-current="true"
            className={`inline-flex min-h-11 items-center rounded-bt bg-fuligem px-3 text-[11px] ${ETIQUETA} text-cal`}
          >
            {opcao.rotulo}
          </span>
        ) : (
          <Link
            key={opcao.valor || "todos"}
            href={href}
            className={`inline-flex min-h-11 items-center rounded-bt border border-fuligem-20 px-3 text-[11px] ${ETIQUETA} text-fuligem-55 transition-colors hover:border-fuligem hover:bg-cal hover:text-fuligem ${FOCO}`}
          >
            {opcao.rotulo}
          </Link>
        );
      })}
    </div>
  );
}
