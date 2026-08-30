import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { formatarCentavos } from "@/lib/painel/dinheiro";
import {
  API_DESCONTOS,
  ROTA_DE_DESCONTOS,
  type RegraCompleta,
} from "@/lib/painel/descontos/contrato";
import { formularioDaRegra } from "@/lib/painel/descontos/formulario.logica";
import { usosEmTexto } from "@/lib/painel/descontos/lista.logica";

import { lerCatalogo } from "../catalogo";
import { FormularioDeRegra } from "../FormularioDeRegra";

/**
 * `/dashboard/descontos/[id]` — a ficha de uma regra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A FICHA É ROTA PRÓPRIA, e não painel lateral.
 *
 * R26 pede painel lateral não-modal para a tela de PEDIDOS, e o motivo lá é
 * triagem: quarenta pedidos, uma decisão de dois segundos cada, próximo e
 * anterior. Aqui é o contrário — uma regra de desconto se edita uma vez, com
 * cuidado, em sete abas e um simulador ao lado. Isso não cabe em painel
 * lateral, e o endereço próprio é o que permite mandar o link da regra para
 * alguém conferir.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELA DEGRADA COM FRASE PRÓPRIA — e por enquanto essa é a única coisa que ela
 * faz.
 *
 * `GET /admin/descontos/:id` ainda não existe no Express: a Onda 3 criou as
 * sete tabelas e a Onda 4 escreveu o motor, mas nenhuma rota de administração
 * do motor foi montada. O checklist de paridade já pedia que "toda tela degrade
 * com frase própria para 404 de módulo ausente, porque produção pode estar
 * atrás do repositório" — aqui não é produção que está atrás, é o backend que
 * ainda não teve a onda dele, e a tela diz isso em vez de mostrar um formulário
 * vazio que pareceria uma regra em branco.
 */
export const metadata: Metadata = {
  title: "Regra de desconto",
  robots: { index: false, follow: false },
};

export default async function PaginaDaRegra({
  params,
}: {
  /** No Next 15 `params` também é uma Promise. */
  params: Promise<{ id: string }>;
}) {
  const [acesso, { id }] = await Promise.all([lerAcessoDoPainel(), params]);

  const [resposta, catalogo] = await Promise.all([
    lerDaApi<RegraCompleta>(`${API_DESCONTOS}/${encodeURIComponent(id)}`),
    lerCatalogo(),
  ]);

  const voltar = (
    <Link
      href={ROTA_DE_DESCONTOS}
      className={`inline-flex min-h-11 items-center justify-center rounded-bt border border-fuligem-20 px-4 text-[11px] ${ETIQUETA} leading-none text-fuligem transition-colors hover:border-fuligem hover:bg-cal ${FOCO}`}
    >
      Voltar à lista
    </Link>
  );

  if (!resposta.ok) {
    return (
      <>
        <Cabecalho titulo="Regra de desconto" email={acesso.email} acao={voltar} />
        <div className="mx-auto max-w-[900px] px-5 py-6">
          {/* A FRASE DO SERVIDOR, INTEIRA. `lerDaApi` já a extraiu com
              `fraseDeErro`, que prefere `message` e depois `error` e só cai no
              genérico com corpo vazio — que é o caso de 401 e 403, que saem por
              `sendStatus`. */}
          <Tarja tom="erro">{resposta.erro}</Tarja>
        </div>
      </>
    );
  }

  const regra = resposta.dados;

  return (
    <>
      <Cabecalho
        titulo={regra.nome}
        descricao="Salvar grava a regra inteira, com escopo, faixas e códigos."
        email={acesso.email}
        acao={voltar}
      />

      <div className="mx-auto max-w-[1400px] space-y-5 px-5 py-6">
        {/*
          O QUE A REGRA JÁ FEZ, no topo e antes do formulário.

          Editar uma regra que já rodou é diferente de editar uma que nunca
          pegou: mudar o percentual de uma campanha com 340 resgates muda o que
          os próximos clientes recebem, e não o que os anteriores receberam. O
          número em cima é o que faz essa diferença ser notada antes da edição,
          e não depois.
        */}
        <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2 rounded-cx border border-fuligem-20 bg-cal-puro px-5 py-3">
          <div className="flex items-baseline gap-2">
            <dt className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>Usos</dt>
            <dd data-dado>{usosEmTexto(regra.usos, regra.limite_usos)}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>Já descontou</dt>
            <dd data-dado>{formatarCentavos(regra.descontado_centavos)}</dd>
          </div>
          {regra.orcamento_centavos !== null && (
            <div className="flex items-baseline gap-2">
              <dt className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>Orçamento</dt>
              <dd data-dado>{formatarCentavos(regra.orcamento_centavos)}</dd>
            </div>
          )}
        </dl>

        <FormularioDeRegra
          /* `formularioDaRegra` NÃO MUTA `regra` — é a linha que separa esta
             tela do defeito legado, onde o load escrevia `active = false` no
             objeto do servidor e o submit gravava aquilo. */
          inicial={formularioDaRegra(regra)}
          regra={regra}
          produtos={catalogo.produtos}
          categorias={catalogo.categorias}
          agoraEmMs={Date.now()}
        />
      </div>
    </>
  );
}
