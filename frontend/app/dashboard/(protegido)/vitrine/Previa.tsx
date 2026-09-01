import { Serra } from "@/components/marca/Serra";
import { ETIQUETA } from "@/components/painel/ui/estilos";
import {
  imagemPermitida,
  textoUtil,
  type FormularioDaVitrine,
  type IdiomaDaVitrine,
} from "@/lib/painel/vitrine/vitrine.logica";
import { IMAGEM_DO_HEROI_PADRAO } from "@/lib/vitrine/heroi";

/**
 * A PRÉVIA AO VIVO — R33 existe para proibir exatamente o padrão de "editar às
 * cegas e abrir a loja em outra aba para conferir".
 *
 * ELA NÃO É UM <iframe> DA HOME, e a decisão é de custo e de foco. Um iframe
 * teria de recarregar a rota inteira a cada tecla (produtos, carrosséis,
 * blog, rodapé) para mostrar um bloco que ocupa a primeira dobra; e a home
 * lê do BANCO, não do formulário, então o iframe mostraria o que está salvo —
 * ou seja, tudo menos o que se está editando. Isto aqui é uma miniatura fiel
 * do bloco: a mesma superfície (`bg-fuligem`), o mesmo kicker em `text-juta`
 * caixa alta com entreletra larga, o mesmo título em `font-titulo`, o mesmo
 * gradiente e a mesma serra. Fiel o bastante para decidir, barata o bastante
 * para renderizar a cada tecla.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE É O ÚNICO ARQUIVO DO PAINEL EM QUE O VERMELHO É ACENTO, E NÃO ERRO.
 *
 * R21 reserva o vermelho a erro e ação destrutiva — no PAINEL. Aqui dentro não
 * há painel: há uma miniatura da LOJA, onde `--color-vermelho` é o acento de
 * marca e o botão primário do herói (`components/ui/Botao.tsx`, variante
 * `primario`) é vermelho sólido. Desenhá-lo preto para obedecer à regra do
 * painel faria a prévia mentir sobre a única coisa que ela existe para mostrar.
 * `components/painel/ui/proibicoes.test.ts` conhece esta exceção pelo nome do
 * arquivo — ela é auditável, não invisível.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O CAMPO VAZIO APARECE COMO CAMPO VAZIO, e isso é a parte mais importante.
 *
 * A prévia NÃO tem como saber o texto de hoje: ele mora na tabela `TEXTOS`
 * dentro de `app/[locale]/(vitrine)/page.tsx`, que é conteúdo daquela página e
 * não sai de lá. Em vez de inventar uma segunda cópia — que divergiria no
 * primeiro ajuste de copy —, o campo em branco é desenhado como uma lacuna
 * pontilhada dizendo "usa o texto de hoje". O gestor vê exatamente a decisão
 * que está tomando: campo preenchido troca, campo vazio conserva. É a regra do
 * fallback aparecendo na tela em vez de ficar escrita num comentário.
 */

/** O nome do idioma por extenso — "PT" sozinho num rótulo não diz a ninguém
 *  que aquilo é um idioma, e a prévia é onde a aba fica longe do olho. */
export const IDIOMA_POR_EXTENSO: Record<IdiomaDaVitrine, string> = {
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
};

/** Uma lacuna: o campo está vazio, e por isso a loja mantém o que já tem. */
function Lacuna({ o: oQue }: { o: string }) {
  return (
    <span
      className={`inline-block border border-dashed border-cal/40 px-2 py-1 text-[10px] ${ETIQUETA} text-cal/60`}
    >
      {oQue} — usa o texto de hoje
    </span>
  );
}

/**
 * A barra de aviso, em miniatura.
 *
 * `font-dado` em 10px caixa alta com `tracking-[0.04em]` é literalmente o que
 * `components/layout/Cabecalho.tsx` desenha. Copiar a classe e não o componente
 * é deliberado: o componente de verdade traz busca, navegação, sacola e o
 * seletor de idioma junto, e nada disso é editável aqui.
 */
function BarraEmMiniatura({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <div className="bg-fuligem text-cal">
      <p className="flex min-h-9 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center font-dado text-[10px] leading-tight tracking-[0.04em]">
        {texto ? <span>{texto}</span> : <Lacuna o="Aviso" />}
        {rotulo && <span className="underline underline-offset-2">{rotulo} →</span>}
      </p>
    </div>
  );
}

export function Previa({
  formulario,
  idioma,
}: {
  formulario: FormularioDaVitrine;
  idioma: IdiomaDaVitrine;
}) {
  const heroi = formulario.textos.heroi[idioma];
  const barra = formulario.textos.barra_aviso[idioma];

  /**
   * A IMAGEM SEGUE A MESMA GUARDA DA LOJA — `imagemPermitida`, a função que
   * `lib/vitrine/heroi.ts` usa. Um endereço de host não liberado desenharia
   * aqui (é um `<img>` cru) e QUEBRARIA lá (o `next/image` lança para host fora
   * de `remotePatterns`): a prévia estaria prometendo o que a loja não entrega.
   * Endereço recusado cai na foto de hoje, que é o que a loja faria.
   */
  const endereco = textoUtil(formulario.heroi.imagem_desktop);
  const imagem = imagemPermitida(endereco) ? endereco : IMAGEM_DO_HEROI_PADRAO;
  const alt = textoUtil(heroi.imagem_alt);

  return (
    /* `<section aria-label>` e não `<div>`: a prévia é uma região da tela, e o
       mesmo padrão da <Ficha> (que rotula a região com o próprio título) dá a
       quem usa leitor de tela um lugar para pular. */
    <section
      aria-label="Prévia da loja"
      className="rounded-cx border border-fuligem-20 bg-cal-puro"
    >
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-fuligem-20 px-5 py-2">
        <h2 className={`text-xs ${ETIQUETA}`}>Prévia da loja</h2>
        <p className="text-[11px] text-fuligem-55">{IDIOMA_POR_EXTENSO[idioma]}</p>
      </div>

      <div className="p-5">
        {/* A moldura de 1px é o "papel e filete" do §4.4 fazendo o trabalho que
            uma sombra faria noutro sistema: ela diz onde a loja começa e o
            painel termina, sem introduzir profundidade que este sistema não
            tem. */}
        <div className="overflow-hidden rounded-cx border border-fuligem-20">
          <BarraEmMiniatura
            texto={textoUtil(barra.texto)}
            rotulo={textoUtil(barra.rotulo_botao)}
          />

          <div className="relative flex min-h-[340px] flex-col justify-end overflow-hidden bg-fuligem text-cal">
            {/*
              `<img>` E NÃO `<Image>` DO NEXT, de propósito. O `next/image`
              LANÇA para host fora de `images.remotePatterns` — e uma prévia que
              derruba a tela do painel enquanto o gestor digita um endereço é
              pior do que uma prévia sem otimização. Aqui não há LCP a defender:
              é uma miniatura atrás de senha.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imagem}
              alt={alt || ""}
              className="absolute inset-0 size-full object-cover object-center"
            />

            {/* O mesmo gradiente de `page.tsx`: sem ele o texto em cal não passa
                contraste sobre a foto, e a prévia mostraria um contraste que a
                loja não tem. */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to top, var(--color-fuligem) 0%, color-mix(in srgb, var(--color-fuligem) 78%, transparent) 38%, color-mix(in srgb, var(--color-fuligem) 30%, transparent) 72%, transparent 100%)",
              }}
            />

            {/* A serra é da LOJA, não do painel: ela está dentro da miniatura
                pelo mesmo motivo que o gradiente. §2.5 conta as aparições da
                "mão" no cromo do painel — login, marca do menu, estado vazio —,
                e uma reprodução da home não é cromo. */}
            <Serra
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[14%] w-full text-fuligem/70"
              strokeWidth={1.5}
              preenchido
            />

            <div className="relative px-6 pb-8 pt-16">
              {textoUtil(heroi.kicker) ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-juta">
                  {heroi.kicker}
                </p>
              ) : (
                <Lacuna o="Chapéu" />
              )}

              {textoUtil(heroi.titulo) ? (
                <h3 className="mt-4 max-w-[14ch] font-titulo text-[34px] leading-[0.95] tracking-[-0.02em]">
                  {heroi.titulo}
                </h3>
              ) : (
                <p className="mt-4">
                  <Lacuna o="Título" />
                </p>
              )}

              {textoUtil(heroi.texto) ? (
                <p className="mt-4 max-w-[52ch] text-[14px] leading-relaxed text-cal/80">
                  {heroi.texto}
                </p>
              ) : (
                <p className="mt-4">
                  <Lacuna o="Texto" />
                </p>
              )}

              {/*
                OS DOIS BOTÕES, porque o herói tem dois e só o primeiro é
                editável. Desenhar só o editável faria o gestor achar que
                "Conhecer a Serra" tinha sumido — a prévia responde "como a loja
                vai ficar", e a resposta inclui o que ele NÃO está mexendo.

                São <span>, e não <button> nem <a>: nada aqui é clicável, e um
                botão de mentira dentro de um formulário é o tipo de coisa que
                alguém aperta uma vez e nunca mais confia.
              */}
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <span className="inline-flex h-10 items-center rounded-bt bg-vermelho px-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white">
                  {textoUtil(heroi.rotulo_botao) || "Ver os cafés"}
                </span>
                <span className="inline-flex h-10 items-center rounded-bt border border-cal px-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-cal">
                  Conhecer a Serra
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* O destino não tem representação visual no herói — ninguém "vê" para
            onde um botão aponta — então ele é dito por escrito. Sem esta linha,
            trocar o destino seria a única edição desta tela sem prévia. */}
        <p className="mt-3 text-[12px] text-fuligem-55">
          O botão leva para{" "}
          <span data-dado>{textoUtil(heroi.destino) || "/cafes"}</span>
          {!textoUtil(heroi.destino) && " (o destino de hoje)"}.
        </p>

        {!alt && (
          <p className="mt-1 text-[12px] text-fuligem-55">
            Sem descrição da imagem, quem usa leitor de tela ouve a legenda da
            foto anterior.
          </p>
        )}
      </div>
    </section>
  );
}
