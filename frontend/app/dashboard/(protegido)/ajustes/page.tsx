import type { Metadata } from "next";
import Link from "next/link";

import { Cabecalho } from "@/components/painel/casca/Cabecalho";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Selo } from "@/components/painel/ui/Selo";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { lerAcessoDoPainel } from "@/lib/conta/painel-servidor";
import { lerDaApi } from "@/lib/painel/api-servidor";
import { ROTA_DE_ADMINISTRADORES } from "@/lib/painel/administradores/administradores.logica";
import {
  SEM_REAUTORIZACAO_PELO_PAINEL,
  estadoDaIntegracao,
  interruptoresDoBling,
  podeSinalizarUso,
  valoresEmUso,
  type OpcaoDaLista,
  type ProdutoDoCatalogo,
  type RespostaDaConfig,
  type SondaDoBling,
} from "@/lib/painel/ajustes/ajustes.logica";

import { FormularioDaLoja } from "./FormularioDaLoja";
import { ListasDeOpcoes } from "./ListasDeOpcoes";

/**
 * `/dashboard/ajustes` — o que se mexe uma vez por mês.
 *
 * TRÊS BLOCOS que não se parecem: a configuração da LOJA (`/config`), as duas
 * listas de valores de filtro (`/options`) e o estado da INTEGRAÇÃO com o Bling
 * (a sonda). O que os une é a frequência: é a última entrada do menu porque é a
 * última coisa que se abre num dia de trabalho.
 *
 * O QUE ESTA TELA NÃO DUPLICA, DE PROPÓSITO:
 *
 *  · A BARRA DE AVISO. Ela é editável em `/dashboard/vitrine` (Onda 2), onde
 *    tem PRÉVIA AO VIVO e abas de idioma — R33 existe exatamente para proibir
 *    "editar às cegas e abrir a loja em outra aba para conferir". A coluna
 *    `config_loja.barra_de_aviso` que o painel legado editava está MORTA: a
 *    0030 moveu o texto para `canastra.vitrine_texto`, e a loja nova lê de lá.
 *    Um segundo editor aqui gravaria numa coluna que ninguém lê — que é
 *    exatamente o defeito que a 0030 corrigiu.
 *
 *  · OS DOIS BANNERS. `banner_desktop` e `banner_mobile` são as outras duas
 *    colunas mortas: o painel legado as editava e a vitrine nova nunca as leu
 *    (spec §1). O herói da home vem de `canastra.vitrine_heroi`, também em
 *    `/dashboard/vitrine`. Construir aqui um uploader que grava numa coluna sem
 *    leitor seria reconstruir o defeito com uma interface nova. Está RELATADO.
 *
 *  · A OPERAÇÃO DE NF-e. Emitir nota, sincronizar e buscar rastreio vivem
 *    DENTRO do detalhe do pedido, porque é ali que o gestor está quando percebe
 *    que a nota não saiu. Aqui fica só a integração: existe credencial? a
 *    autorização renova? o interruptor está ligado?
 *
 * SERVER COMPONENT QUE LÊ, ILHAS DE CLIENTE QUE ESCREVEM (spec §2.3). As três
 * leituras saem juntas; o JavaScript existe pelo formulário e pelos diálogos.
 */
export const metadata: Metadata = {
  title: "Ajustes",
  // Ferramenta de trabalho atrás de senha, como toda rota deste grupo.
  robots: { index: false, follow: false },
};

/** O que `GET /dashboard` devolve, no recorte que esta tela usa: ela só quer
 *  saber quais valores de categoria e embalagem estão em uso. */
type RespostaDoCatalogo = { products?: ProdutoDoCatalogo[]; total?: number };

/** O link em texto do painel — sublinhado, sem virar botão: é navegação para
 *  outra tela, e um botão prometeria que algo acontece aqui. */
const LINK = `underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`;

export default async function PaginaDeAjustes() {
  const [acesso, config, opcoes, catalogo, bling] = await Promise.all([
    /* A segunda leitura da sessão nesta requisição — a mesma dívida que
       `(protegido)/page.tsx` já registrou: aqui ela paga só o e-mail do
       cabeçalho. */
    lerAcessoDoPainel(),
    lerDaApi<RespostaDaConfig>("/config"),
    lerDaApi<OpcaoDaLista[]>("/options"),
    /*
      O CATÁLOGO SÓ PARA SABER O QUE ESTÁ EM USO. `limit=200` é o teto da rota;
      quando o catálogo é maior, `podeSinalizarUso` devolve `false` e a tela
      NÃO marca nada — marca errada numa tela de exclusão convida ao clique.
    */
    lerDaApi<RespostaDoCatalogo>("/dashboard?limit=200"),
    lerDaApi<SondaDoBling>("/bling/status"),
  ]);

  /*
    OS QUATRO FALHAM SEPARADAMENTE, e é assim que tem de ser: o Bling fora do ar
    não pode apagar o campo de frete grátis da tela, e uma falha em `/options`
    não pode esconder o estado da integração. Cada bloco desenha o próprio erro.
    Um `<EstadoDaTela>` em volta da página inteira colapsaria quatro
    diagnósticos num só — e o gestor abriria chamado dizendo "os ajustes não
    abrem" sobre uma tela em que três dos quatro blocos funcionam.
  */
  const produtos = catalogo.ok ? (catalogo.dados.products ?? []) : [];
  const totalDoCatalogo = catalogo.ok ? (catalogo.dados.total ?? 0) : Number.NaN;
  const marcarUso = catalogo.ok && podeSinalizarUso(totalDoCatalogo, produtos.length);

  const integracao = estadoDaIntegracao(bling.ok ? bling.dados : null);

  return (
    <>
      <Cabecalho
        titulo="Ajustes"
        descricao="A loja, os valores de filtro e a integração com o Bling."
        email={acesso.email}
        /* SEM AÇÃO PRIMÁRIA. R18 quer uma por página, sempre no mesmo lugar —
           e esta tela tem três blocos que salvam separadamente, cada um com o
           seu botão colado ao que ele grava. Um "Salvar" no cabeçalho não
           saberia o que salva, e um botão de canto que só serve a um dos três
           blocos é pior que canto vazio. */
      />

      <div className="mx-auto max-w-[1000px] space-y-6 px-5 py-6">
        {/* ------------------------------------------------------------------
            BLOCO 1 — A LOJA
            ------------------------------------------------------------------ */}
        <Ficha titulo="A loja">
          {config.ok ? (
            <FormularioDaLoja config={config.dados} />
          ) : (
            /*
              FORMULÁRIO NENHUM QUANDO A LEITURA FALHOU. Um formulário em branco
              por causa de rede caída é um convite a salvar o branco por cima do
              que estava lá — e neste formulário o campo em branco é o que
              desligava o frete grátis da loja inteira. É a mesma decisão da
              tela de vitrine.
            */
            <Tarja>{config.erro}</Tarja>
          )}
        </Ficha>

        {/* ------------------------------------------------------------------
            O QUE MORA EM OUTRA TELA — apontado, não duplicado
            ------------------------------------------------------------------ */}
        <Ficha titulo="Herói e barra de aviso">
          <div className="max-w-[70ch] space-y-2 text-[13px]">
            <p>
              O texto da barra de aviso e a imagem do herói da home são
              editados em{" "}
              <Link href="/dashboard/vitrine" className={LINK}>
                Vitrine
              </Link>
              , com prévia ao vivo e abas de idioma.
            </p>
            <p className="text-[12px] text-fuligem-55">
              Eles não estão aqui de propósito: editar texto de loja sem ver o
              resultado é como se publica &quot;R$ 5,90&quot; no lugar de
              &quot;R$ 59,00&quot;. As colunas antigas de banner e de barra de
              aviso continuam no banco, mas a loja nova não lê nenhuma delas.
            </p>
          </div>
        </Ficha>

        {/* ------------------------------------------------------------------
            BLOCO 2 — CATEGORIAS E EMBALAGENS
            ------------------------------------------------------------------ */}
        <section aria-label="Valores de filtro" className="space-y-3">
          <h2 className={`text-xs ${ETIQUETA} text-fuligem`}>Valores de filtro</h2>
          {opcoes.ok ? (
            <ListasDeOpcoes
              opcoes={Array.isArray(opcoes.dados) ? opcoes.dados : []}
              emUso={[...valoresEmUso(produtos)]}
              podeMarcarUso={marcarUso}
            />
          ) : (
            <Tarja>{opcoes.erro}</Tarja>
          )}
        </section>

        {/* ------------------------------------------------------------------
            BLOCO 3 — BLING
            ------------------------------------------------------------------ */}
        <Ficha
          titulo="Integração com o Bling"
          /* O selo do estado fica no CABEÇALHO da ficha: é a resposta que se vem
             buscar aqui, e ela precisa estar visível antes de qualquer leitura. */
          acao={<Selo tom={integracao.tom}>{integracao.titulo}</Selo>}
        >
          <div className="space-y-4">
            {/*
              O TOM VEM DA ORDEM DA VIDA DA CREDENCIAL, decidida no módulo puro.
              Sem credencial NÃO é vermelho: é o estado de fábrica, e R21
              reserva o vermelho a erro e ação destrutiva — pintar de vermelho o
              estado normal de quem nunca ligou a integração ensina a ignorar
              vermelho. Vermelho aqui é só o token que parou de renovar, que é
              erro de verdade: a nota falha com o pedido do cliente já pago.
            */}
            <Tarja tom={integracao.tom === "neutro" ? "aviso" : integracao.tom}>
              {integracao.texto}
            </Tarja>

            <dl className="space-y-2">
              {interruptoresDoBling(bling.ok ? bling.dados : null).map((item) => (
                <div
                  key={item.variavel}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-fuligem-20 pb-2 last:border-b-0"
                >
                  <dt className="text-[13px]">
                    {item.rotulo}{" "}
                    {/* O NOME DA VARIÁVEL é o que transforma "está desligado"
                        em algo acionável — sem ele, o gestor abre chamado para
                        perguntar qual é. `data-dado` porque é código, e código
                        é dado (§2.5). */}
                    <code data-dado className="text-[12px] text-fuligem-55">
                      {item.variavel}
                    </code>
                  </dt>
                  <dd>
                    <Selo tom={item.ligado ? "sucesso" : "neutro"}>
                      {item.ligado ? "Ligado" : "Desligado"}
                    </Selo>
                  </dd>
                </div>
              ))}
            </dl>

            {/*
              A TELA DIZ O QUE NÃO CONSEGUE FAZER — a doutrina da tela de
              Assinaturas. Não há rota de callback OAuth nem caminho para colar
              um refresh token novo: o primeiro vai na publicação da API, e a
              partir daí ele se renova sozinho. Dizer isso separa "a tela não
              tem o botão" de "a tela está quebrada". Está RELATADO como falta
              de backend.
            */}
            <p className="max-w-[70ch] text-[12px] text-fuligem-55">
              {SEM_REAUTORIZACAO_PELO_PAINEL}
            </p>

            <p className="max-w-[70ch] text-[12px] text-fuligem-55">
              Emitir a nota de um pedido, sincronizar e buscar rastreio ficam
              dentro do próprio pedido, em{" "}
              <Link href="/dashboard/pedidos" className={LINK}>
                Pedidos
              </Link>{" "}
              — é lá que você está quando percebe que a nota não saiu.
            </p>
          </div>
        </Ficha>

        {/* ------------------------------------------------------------------
            QUEM ADMINISTRA — a porta para a tela que o menu ainda não tem
            ------------------------------------------------------------------ */}
        <Ficha titulo="Quem administra a loja">
          <div className="max-w-[70ch] space-y-2 text-[13px]">
            <p>
              Listar, promover e remover administradores fica em{" "}
              <Link href={ROTA_DE_ADMINISTRADORES} className={LINK}>
                Administradores
              </Link>
              .
            </p>
            <p className="text-[12px] text-fuligem-55">
              Vale abrir hoje: até esta reescrita não havia caminho nenhum para
              promover um segundo gestor, e a senha do painel não tem como ser
              recuperada de dentro. Com um administrador só, a loja fica a um
              esquecimento de perder a gestão.
            </p>
          </div>
        </Ficha>
      </div>
    </>
  );
}
