"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import {
  CAMPOS_DE_HEROI,
  IDIOMAS,
  caminhoDoHeroi,
  caminhoDoTexto,
  estaSujo,
  formularioDaResposta,
  idiomasComErro,
  idiomasComMudanca,
  montarPayload,
  validar,
  type CampoDeHeroi,
  type CampoDeTexto,
  type ChaveDeTexto,
  type FormularioDaVitrine as Formulario,
  type IdiomaDaVitrine,
} from "@/lib/painel/vitrine/vitrine.logica";

import { salvarVitrine } from "./acoes";
import { IDIOMA_POR_EXTENSO, Previa } from "./Previa";

/**
 * O EDITOR DA VITRINE — a ilha de cliente desta tela.
 *
 * Ela é cliente porque a prévia tem de acompanhar a digitação (R33) e porque a
 * barra de salvar só aparece quando há o que salvar (R5). Fora isso, tudo que
 * é DECISÃO mora em `lib/painel/vitrine/vitrine.logica.ts` e é testado como
 * função pura: o que sobra aqui é desenho, foco e o instante de cada coisa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O ERRO APARECE NO SUBMIT, NUNCA ANTES — R8.
 *
 * `validar` roda a cada tecla, mas o resultado só é ENTREGUE aos campos depois
 * da primeira tentativa de salvar (`tentouSalvar`). Marcar de vermelho um campo
 * que a pessoa ainda está no meio de preencher é acusá-la de errar uma coisa
 * que ela ainda não terminou de fazer, e treina o gestor a ver vermelho como
 * ruído. Depois da primeira cobrança, a mensagem some AO VIVO durante a
 * correção — é o mesmo contrato que o `<Campo>` já implementa internamente para
 * a sua própria regra local.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A IMAGEM FICA FORA DAS ABAS, e isso não é arrumação: é o desenho da tabela.
 *
 * `vitrine_heroi` é uma linha só, com a imagem para os três idiomas; o texto é
 * uma linha por (chave, idioma). Pedir três uploads da mesma foto é trabalho
 * inventado, e uma imagem DENTRO da aba de português faria o gestor acreditar
 * que existem três — trocaria uma e acharia que as outras duas continuaram
 * antigas.
 */

/** O que cada campo do herói é, em português de gente. A tabela existe para o
 *  JSX não repetir nove vezes a mesma linha, e para rótulo e ajuda ficarem
 *  lado a lado quando alguém for reescrevê-los. */
const CAMPOS_DO_HEROI: {
  campo: CampoDeTexto;
  rotulo: string;
  ajuda?: string;
  exemplo?: string;
}[] = [
  {
    campo: "kicker",
    rotulo: "Chapéu",
    ajuda: "A linha pequena acima do título, em caixa alta.",
    exemplo: "Serra da Canastra · Minas Gerais",
  },
  {
    campo: "titulo",
    rotulo: "Título",
    ajuda: "Curto. Ele é desenhado em corpo grande e quebra em duas linhas.",
    exemplo: "Café que vem de cima.",
  },
  {
    campo: "texto",
    rotulo: "Texto",
    ajuda: "Uma ou duas frases abaixo do título.",
    exemplo: "Torrado sob demanda, em lotes pequenos.",
  },
  {
    campo: "rotulo_botao",
    rotulo: "Rótulo do botão",
    ajuda: "Só o primeiro botão é editável; o segundo continua sendo a Serra.",
    exemplo: "Ver os cafés",
  },
  {
    campo: "destino",
    rotulo: "Destino do botão",
    ajuda: 'Caminho da loja começando com "/" ou endereço completo com https://.',
    exemplo: "/cafes",
  },
  {
    campo: "imagem_alt",
    rotulo: "Descrição da imagem",
    ajuda: "O que quem não enxerga ouve no lugar da foto. Obrigatória se houver imagem.",
    exemplo: "Cozinha mineira ao amanhecer, com um pacote de Café Canastra na mesa",
  },
];

const CAMPOS_DA_BARRA: { campo: CampoDeTexto; rotulo: string; ajuda?: string; exemplo?: string }[] =
  [
    {
      campo: "texto",
      rotulo: "Aviso",
      ajuda: "A faixa escura no topo de toda página da loja.",
      exemplo: "Torrado sob demanda",
    },
    {
      campo: "rotulo_botao",
      rotulo: "Rótulo do link",
      ajuda: "Deixe em branco para a faixa não ter link.",
      exemplo: "Ver os cafés",
    },
    {
      campo: "destino",
      rotulo: "Destino do link",
      exemplo: "/cafes",
    },
  ];

const CAMPOS_DA_IMAGEM: { campo: CampoDeHeroi; rotulo: string; ajuda: string }[] = [
  {
    campo: "imagem_desktop",
    /* O rótulo NÃO repete o título da ficha ("Imagem do herói"): dois nomes
       acessíveis idênticos na mesma tela obrigam quem usa leitor de tela a
       visitar os dois para descobrir qual é qual. */
    rotulo: "Endereço da imagem",
    ajuda:
      "Endereço da foto. Em branco, a loja continua com a foto de hoje (/imagem-banner.jpg).",
  },
  {
    campo: "imagem_mobile",
    rotulo: "Endereço no telefone",
    ajuda: "Opcional. Em branco, o telefone usa a mesma foto do computador.",
  },
];

export function FormularioDaVitrine({ inicial }: { inicial: Formulario }) {
  const [base, setBase] = useState<Formulario>(inicial);
  const [forma, setForma] = useState<Formulario>(inicial);
  const [idioma, setIdioma] = useState<IdiomaDaVitrine>("pt");
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "erro"; texto: string } | null>(
    null,
  );

  const idDasAbas = useId();
  const abas = useRef<(HTMLButtonElement | null)[]>([]);

  const sujo = estaSujo(base, forma);
  const errosDeVerdade = useMemo(() => validar(forma), [forma]);
  /** O que os campos VEEM. Vazio antes da primeira tentativa — ver R8, acima. */
  const erros = tentouSalvar ? errosDeVerdade : {};
  const idiomasErrados = idiomasComErro(erros);
  const idiomasMudados = idiomasComMudanca(base, forma);

  /**
   * O BLOQUEIO DE SAÍDA — R5.
   *
   * `beforeunload` cobre fechar a aba, recarregar e sair para outro site: os
   * três caminhos em que o navegador ainda deixa perguntar. NAVEGAÇÃO INTERNA
   * (clicar em "Pedidos" no menu) NÃO É COBERTA, e não é esquecimento: o App
   * Router do Next 15 não expõe API estável para interromper uma transição de
   * rota, e as saídas conhecidas envolvem interceptar clique em `<a>` no
   * documento — um remendo global que quebra em silêncio no dia em que um link
   * novo aparecer. O que sobra a favor do gestor é a barra de salvar, que fica
   * presa no rodapé da tela enquanto houver alteração pendente.
   */
  useEffect(() => {
    if (!sujo) return;
    function avisar(evento: BeforeUnloadEvent) {
      evento.preventDefault();
      // Navegadores modernos ignoram o texto e mostram a frase padrão deles;
      // `returnValue` continua sendo o que liga o diálogo no Chrome antigo.
      evento.returnValue = "";
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  function mudarTexto(
    chave: ChaveDeTexto,
    campo: CampoDeTexto,
    valor: string,
  ) {
    setConfirmandoDescarte(false);
    setForma((atual) => ({
      ...atual,
      textos: {
        ...atual.textos,
        [chave]: {
          ...atual.textos[chave],
          [idioma]: { ...atual.textos[chave][idioma], [campo]: valor },
        },
      },
    }));
  }

  function mudarImagem(campo: CampoDeHeroi, valor: string) {
    setConfirmandoDescarte(false);
    setForma((atual) => ({ ...atual, heroi: { ...atual.heroi, [campo]: valor } }));
  }

  function descartar() {
    setForma(base);
    setTentouSalvar(false);
    setConfirmandoDescarte(false);
    setAviso(null);
  }

  async function salvar() {
    setTentouSalvar(true);
    setConfirmandoDescarte(false);

    const problemas = validar(forma);
    if (Object.keys(problemas).length) {
      // Levar a pessoa até o erro, e não só dizer que ele existe: o campo pode
      // estar numa aba fechada, e uma tarja apontando para uma tela onde não há
      // nada marcado é o que faz o gestor clicar em Salvar até desistir.
      const primeiro = idiomasComErro(problemas)[0];
      if (primeiro) setIdioma(primeiro);
      setAviso({
        tom: "erro",
        texto: "Confira os campos marcados — nada foi salvo ainda.",
      });
      return;
    }

    const corpo = montarPayload(base, forma);
    if (!Object.keys(corpo).length) return;

    setSalvando(true);
    setAviso(null);
    try {
      const resultado = await salvarVitrine(corpo);
      if (!resultado.ok) {
        setAviso({ tom: "erro", texto: resultado.erro });
        return;
      }
      /**
       * A BASE VEM DA RESPOSTA, e não do que foi enviado. O `PUT` devolve o
       * estado inteiro lido dentro da mesma transação: rebasear com ele é o que
       * faz a tela contar a verdade quando o banco normalizou alguma coisa (um
       * `""` que virou NULL, por exemplo). Rebasear com o que se digitou deixa
       * o formulário "limpo" mostrando um valor que não está gravado.
       */
      const gravado = formularioDaResposta(resultado.estado);
      setBase(gravado);
      setForma(gravado);
      setTentouSalvar(false);
      setAviso({ tom: "sucesso", texto: "Vitrine salva. A loja já está mostrando." });
    } finally {
      setSalvando(false);
    }
  }

  /**
   * As setas do teclado nas abas.
   *
   * O padrão de abas da WAI-ARIA exige isto: só a aba ativa fica no ciclo do
   * Tab (`tabIndex -1` nas outras), e a troca entre elas é por seta. Sem as
   * setas, quem navega por teclado fica preso na aba de português e nunca
   * alcança o inglês — a tela teria dois terços do conteúdo inacessíveis.
   */
  function navegarPorTeclado(evento: KeyboardEvent<HTMLDivElement>) {
    const atual = IDIOMAS.indexOf(idioma);
    const passo =
      evento.key === "ArrowRight" ? 1 : evento.key === "ArrowLeft" ? -1 : 0;

    let destino = -1;
    if (passo) destino = (atual + passo + IDIOMAS.length) % IDIOMAS.length;
    if (evento.key === "Home") destino = 0;
    if (evento.key === "End") destino = IDIOMAS.length - 1;
    if (destino < 0) return;

    evento.preventDefault();
    setIdioma(IDIOMAS[destino]);
    abas.current[destino]?.focus();
  }

  const painelDoIdioma = `${idDasAbas}-painel`;

  return (
    <div className="pb-4">
      {aviso && (
        <div className="mb-5">
          <Tarja tom={aviso.tom} onFechar={() => setAviso(null)}>
            {aviso.texto}
          </Tarja>
        </div>
      )}

      {/*
        EDITOR À ESQUERDA, PRÉVIA À DIREITA — R33. Em coluna única abaixo de
        `lg`, com a prévia PRIMEIRO no código e reordenada por `lg:order`? Não:
        ela vem depois mesmo. Numa tela estreita, quem abriu esta página veio
        editar, e empurrar seis campos para baixo de uma miniatura de 340px é
        fazer rolar antes de trabalhar. A prévia gruda no topo só onde há duas
        colunas de verdade.
      */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-5">
          <Ficha titulo="Imagem do herói">
            <div className="space-y-4">
              {CAMPOS_DA_IMAGEM.map(({ campo, rotulo, ajuda }) => (
                <Campo
                  key={campo}
                  rotulo={rotulo}
                  ajuda={ajuda}
                  erro={erros[caminhoDoHeroi(campo)] ?? null}
                  value={forma.heroi[campo]}
                  onChange={(e) => mudarImagem(campo, e.target.value)}
                  placeholder="/imagem-banner.jpg"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                />
              ))}
              <p className="text-[12px] text-fuligem-55">
                A mesma imagem serve os três idiomas — foto não se traduz.
              </p>
            </div>
          </Ficha>

          <Ficha
            titulo="Texto por idioma"
            semPreenchimento
            /* As abas no CABEÇALHO da ficha, e não dentro do corpo: elas
               governam tudo o que está abaixo, e uma tira de abas flutuando no
               meio do conteúdo não diz o que ela troca. */
            acao={
              <div
                role="tablist"
                aria-label="Idioma do texto"
                onKeyDown={navegarPorTeclado}
                className="flex items-center gap-1"
              >
                {IDIOMAS.map((cada, i) => {
                  const ativo = cada === idioma;
                  return (
                    <button
                      key={cada}
                      ref={(no) => {
                        abas.current[i] = no;
                      }}
                      type="button"
                      role="tab"
                      id={`${idDasAbas}-${cada}`}
                      aria-selected={ativo}
                      aria-controls={painelDoIdioma}
                      tabIndex={ativo ? 0 : -1}
                      onClick={() => setIdioma(cada)}
                      className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-[11px] ${ETIQUETA} ${FOCO} ${
                        ativo
                          ? "border-fuligem text-fuligem"
                          : "border-transparent text-fuligem-55 hover:text-fuligem"
                      }`}
                    >
                      {cada}
                      {/*
                        OS DOIS MARCADORES DA ABA, e nenhum deles é só cor.
                        `!` diz "há erro aqui" e `•` diz "há alteração aqui";
                        o `sr-only` ao lado carrega a mesma informação para quem
                        não vê o glifo — WCAG 1.4.1, a cor nunca é o canal.
                      */}
                      {idiomasErrados.includes(cada) ? (
                        <>
                          <span aria-hidden="true">!</span>
                          <span className="sr-only">(com erro)</span>
                        </>
                      ) : idiomasMudados.includes(cada) ? (
                        <>
                          <span aria-hidden="true">•</span>
                          <span className="sr-only">(alterado)</span>
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            }
          >
            <div
              id={painelDoIdioma}
              role="tabpanel"
              aria-labelledby={`${idDasAbas}-${idioma}`}
              /* `tabIndex={0}` porque o painel tem conteúdo focável e o padrão
                 ARIA pede que ele mesmo receba foco vindo da aba. */
              tabIndex={0}
              className={`space-y-6 p-5 ${FOCO}`}
            >
              <div className="space-y-4">
                <h3 className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
                  Herói da home — {IDIOMA_POR_EXTENSO[idioma]}
                </h3>
                {CAMPOS_DO_HEROI.map(({ campo, rotulo, ajuda, exemplo }) => (
                  <Campo
                    key={campo}
                    rotulo={rotulo}
                    ajuda={ajuda}
                    erro={erros[caminhoDoTexto("heroi", idioma, campo)] ?? null}
                    value={forma.textos.heroi[idioma][campo]}
                    onChange={(e) => mudarTexto("heroi", campo, e.target.value)}
                    placeholder={exemplo}
                    autoComplete="off"
                  />
                ))}
              </div>

              <div className="space-y-4 border-t border-fuligem-20 pt-5">
                <h3 className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
                  Barra de aviso — {IDIOMA_POR_EXTENSO[idioma]}
                </h3>
                {CAMPOS_DA_BARRA.map(({ campo, rotulo, ajuda, exemplo }) => (
                  <Campo
                    key={campo}
                    rotulo={rotulo}
                    ajuda={ajuda}
                    erro={erros[caminhoDoTexto("barra_aviso", idioma, campo)] ?? null}
                    value={forma.textos.barra_aviso[idioma][campo]}
                    onChange={(e) => mudarTexto("barra_aviso", campo, e.target.value)}
                    placeholder={exemplo}
                    autoComplete="off"
                  />
                ))}
              </div>
            </div>
          </Ficha>
        </div>

        <div className="min-w-0 lg:sticky lg:top-[132px]">
          <Previa formulario={forma} idioma={idioma} />
        </div>
      </div>

      {/*
        A BARRA DE SALVAR É CONTEXTUAL — ela nasce com a primeira alteração e
        morre com o salvamento. Um botão "Salvar" sempre presente e sempre
        clicável ensina a clicar por precaução, e aí ninguém sabe mais se há ou
        não trabalho pendente.

        `sticky bottom-0` e não `fixed`: ela pertence ao formulário, e a largura
        dela tem de ser a do conteúdo, não a da janela — com o menu lateral de
        `md` para cima, uma barra fixa começaria debaixo do menu.
      */}
      {sujo && (
        <div className="sticky bottom-0 z-30 mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-cx border border-fuligem-20 bg-cal-puro px-5 py-3">
          <p className="text-[13px] text-fuligem-55">
            Alterações não salvas
            {idiomasMudados.length > 0 && (
              <> em {idiomasMudados.map((i) => IDIOMA_POR_EXTENSO[i]).join(", ")}</>
            )}
            .
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              DESCARTAR É DESTRUTIVO E PEDE DUAS ETAPAS. Não há diálogo modal
              nesta onda, e não se inventa primitivo novo (spec Task 3): o
              próprio botão troca de rótulo e de peso. Um clique errado num
              "Descartar" de uma etapa apaga meia hora de digitação sem nada
              para desfazer.
            */}
            {confirmandoDescarte ? (
              <>
                <Botao variante="secundaria" onClick={() => setConfirmandoDescarte(false)}>
                  Continuar editando
                </Botao>
                <Botao variante="destrutiva" onClick={descartar}>
                  Descartar mesmo
                </Botao>
              </>
            ) : (
              <Botao variante="secundaria" onClick={() => setConfirmandoDescarte(true)}>
                Descartar
              </Botao>
            )}

            <Botao onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}
