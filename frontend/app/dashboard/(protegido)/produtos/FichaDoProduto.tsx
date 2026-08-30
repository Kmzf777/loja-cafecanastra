"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { Ficha } from "@/components/painel/ui/Ficha";
import { Selo } from "@/components/painel/ui/Selo";
import { Tarja } from "@/components/painel/ui/Tarja";
import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { formatarReais } from "@/lib/painel/dinheiro";
import { urlDaImagemDoPainel } from "@/lib/painel/transporte";
import {
  ABAS,
  FORMULARIO_VAZIO,
  abasComErro,
  abasComMudanca,
  corpoDoProduto,
  estaSujo,
  formularioDoProduto,
  margem,
  medidasDaForma,
  recusaDaImagem,
  recusaDoCusto,
  validar,
  type AbaDaFicha,
  type CustoDoProduto,
  type FormularioDoProduto,
} from "@/lib/painel/produtos/ficha.logica";
import {
  AVISO_SEM_SKU,
  ROTA_DE_PRODUTOS,
  medidaEhOPadrao,
  type ProdutoDoPainel,
} from "@/lib/painel/produtos/produtos.logica";

import { ajustarEstoque, salvarCusto, salvarProduto } from "./acoes";
import { BlocoDoEstado } from "./BlocoDoEstado";
import { BlocoFiscalPendente } from "./BlocoFiscalPendente";

/**
 * A FICHA DE UM PRODUTO — quatro abas, uma barra de salvar, três rotas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRÊS ROTAS PARA UMA TELA, e cada uma existe por um motivo diferente.
 *
 *   `PUT /dashboard/:id` ................ o catálogo: nome, SKU, preço,
 *                                         embalagem, categoria, descrição,
 *                                         imagem e AS QUATRO MEDIDAS.
 *   `PATCH /dashboard/:id/estoque` ...... o estoque sozinho, sem multipart e
 *                                         sem reenviar a foto.
 *   `PATCH /admin/produtos/:id/custo` ... o custo, que a coluna não entrega a
 *                                         `authenticated` nem para a admin.
 *
 * Elas NÃO se fundem numa só, e o backend escreve por quê: custo "não é campo
 * de catálogo, é de gestão, e misturá-lo ao `PUT` faria toda edição de preço
 * carregar a margem junto — com o risco de zerá-la quando o campo viesse
 * vazio". E o estoque ganhou rota própria justamente porque o caminho antigo
 * (reenviar o formulário inteiro por multipart) era por onde as medidas da
 * caixa eram apagadas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A ABA É ESTADO LOCAL, SEMEADO PELA URL — e a mistura é deliberada.
 *
 * `?aba=fiscal` funciona como link: dá para mandar a alguém a aba fiscal de um
 * café. Mas TROCAR de aba não navega, e não pode: uma navegação re-renderizaria
 * o Server Component e o formulário perderia tudo o que estivesse digitado e
 * não salvo. Deep-link na entrada, estado local depois.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * R5 — SAVE BAR CONTEXTUAL E BLOQUEIO DE SAÍDA. A barra nasce com a primeira
 * alteração e morre com o salvamento; um "Salvar" sempre presente e sempre
 * clicável ensina a clicar por precaução, e aí ninguém sabe mais se há trabalho
 * pendente.
 *
 * R6 — PREÇO E ESTOQUE NUNCA COM AUTOSAVE. Não há um único `onBlur` que grave
 * nesta tela: "uma vírgula errada publica R$ 5,90 no lugar de R$ 59,00", e o
 * intervalo entre digitar e salvar é a única chance de ver o erro.
 *
 * R8 — O ERRO APARECE NO SUBMIT, NUNCA ANTES. `validar` roda a cada tecla, mas
 * o resultado só é ENTREGUE aos campos depois da primeira tentativa de salvar.
 * Marcar de vermelho um campo que a pessoa ainda está no meio de preencher é
 * acusá-la de errar uma coisa que ela ainda não terminou.
 */
export function FichaDoProduto({
  produto,
  custoInicial,
  erroDoCusto,
  abaInicial,
}: {
  /** `null` no cadastro — a mesma tela, sem id. */
  produto: ProdutoDoPainel | null;
  custoInicial: CustoDoProduto | null;
  /** A frase de por que o custo não veio, quando não veio. */
  erroDoCusto: string | null;
  abaInicial: AbaDaFicha;
}) {
  const router = useRouter();
  const ehNovo = produto === null;

  const inicial = useMemo(
    () => (produto ? formularioDoProduto(produto) : FORMULARIO_VAZIO),
    [produto],
  );

  const [base, setBase] = useState<FormularioDoProduto>(inicial);
  const [forma, setForma] = useState<FormularioDoProduto>(inicial);
  const [aba, setAba] = useState<AbaDaFicha>(abaInicial);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "sucesso" | "erro"; texto: string } | null>(
    null,
  );

  /** O arquivo escolhido, e a recusa local dele. A imagem NÃO entra em `forma`:
   *  ela não tem valor "atual" com que comparar, então ela não suja o
   *  formulário do mesmo jeito — ela é uma substituição, não uma edição. */
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [recusaDoArquivo, setRecusaDoArquivo] = useState<string | null>(null);
  const campoDeArquivo = useRef<HTMLInputElement | null>(null);

  const idDasAbas = useId();
  const botoesDasAbas = useRef<(HTMLButtonElement | null)[]>([]);

  const sujo = estaSujo(base, forma) || arquivo !== null;
  const errosDeVerdade = useMemo(() => validar(forma), [forma]);
  /** O que os campos VEEM. Vazio antes da primeira tentativa — ver R8, acima. */
  const erros = tentouSalvar ? errosDeVerdade : {};
  const abasErradas = abasComErro(erros);
  const abasMudadas = abasComMudanca(base, forma);

  /**
   * O BLOQUEIO DE SAÍDA — R5.
   *
   * `beforeunload` cobre fechar a aba, recarregar e sair para outro site: os
   * três caminhos em que o navegador ainda deixa perguntar. NAVEGAÇÃO INTERNA
   * (clicar em "Pedidos" no menu) NÃO É COBERTA, e não é esquecimento: o App
   * Router do Next 15 não expõe API estável para interromper uma transição de
   * rota, e as saídas conhecidas envolvem interceptar clique em `<a>` no
   * documento — um remendo global que quebra em silêncio no dia em que um link
   * novo aparecer. O que sobra a favor do gestor é a barra de salvar, presa no
   * rodapé enquanto houver alteração pendente. É a mesma decisão, com o mesmo
   * limite, da tela de Vitrine.
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

  function mudar(campo: keyof FormularioDoProduto, valor: string) {
    setConfirmandoDescarte(false);
    setForma((atual) => ({ ...atual, [campo]: valor }));
  }

  function escolherArquivo(evento: ChangeEvent<HTMLInputElement>) {
    const escolhido = evento.target.files?.[0] ?? null;
    setConfirmandoDescarte(false);
    if (!escolhido) {
      setArquivo(null);
      setRecusaDoArquivo(null);
      return;
    }

    /*
      A RECUSA ACONTECE AQUI, ANTES DE O ARQUIVO SAIR DA MÁQUINA. O backend já
      sabe falar (a Onda 4 traduziu o `MulterError` para 400 com frase), mas
      mandar 40 MB por uma conexão de escritório para receber a recusa dois
      minutos depois é a pior forma de descobrir um limite. As frases são as
      MESMAS do servidor, palavra por palavra: duas redações para a mesma recusa
      fazem parecer dois problemas.
    */
    const recusa = recusaDaImagem(escolhido);
    if (recusa) {
      setRecusaDoArquivo(recusa);
      setArquivo(null);
      // O input é limpo junto: deixar o nome do arquivo recusado na tela ao
      // lado da mensagem de recusa faz parecer que ele foi aceito.
      if (campoDeArquivo.current) campoDeArquivo.current.value = "";
      return;
    }

    setRecusaDoArquivo(null);
    setArquivo(escolhido);
  }

  function descartar() {
    setForma(base);
    setArquivo(null);
    setRecusaDoArquivo(null);
    if (campoDeArquivo.current) campoDeArquivo.current.value = "";
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
      const primeira = abasComErro(problemas)[0];
      if (primeira) setAba(primeira);
      setAviso({
        tom: "erro",
        texto: "Confira os campos marcados — nada foi salvo ainda.",
      });
      return;
    }

    const dados = new FormData();
    for (const [chave, valor] of Object.entries(corpoDoProduto(forma))) {
      dados.set(chave, valor);
    }
    if (arquivo) dados.set("image", arquivo);

    setSalvando(true);
    setAviso(null);
    try {
      const resultado = await salvarProduto(produto?.product_id ?? null, dados);
      if (!resultado.ok) {
        // A FRASE DO SERVIDOR, INTEIRA. "Já existe um produto com este SKU."
        // resolve o problema em dois minutos; "Erro ao salvar" abre um chamado.
        setAviso({ tom: "erro", texto: resultado.erro });
        return;
      }

      if (ehNovo) {
        /*
          O CADASTRO VOLTA PARA A LISTA, e não fica na ficha, porque não há como
          ficar: `POST /dashboard` responde 201 com `{message}` e NÃO devolve o
          `produto_id`. Sem id não há `/dashboard/produtos/[id]` para onde ir, e
          inventar uma busca por SKU logo depois seria adivinhar. Está no
          relatório como falta de backend.
        */
        setArquivo(null);
        setBase(forma);
        router.push(ROTA_DE_PRODUTOS);
        return;
      }

      /*
        A BASE PASSA A SER O QUE FOI ENVIADO. Ao contrário da tela de Vitrine,
        `PUT /dashboard/:id` devolve só `{message}` — não há estado gravado com
        que rebasear, então o formulário fica mostrando exatamente o que ele
        mandou.

        E ISSO TEM UM LIMITE QUE VALE ESCREVER: a `revalidatePath` da ação
        atualiza a LISTA e o HTML desta rota, mas não este formulário — o estado
        do React sobrevive ao re-render, que é justamente o que impede a tela de
        apagar o que a pessoa está digitando. A verdade do banco volta numa
        navegação de verdade (sair e voltar, ou F5). O caso em que os dois
        divergem é duas pessoas editando o mesmo café ao mesmo tempo, e para
        esse não há resposta boa sem versionamento no backend.
      */
      setBase(forma);
      setArquivo(null);
      if (campoDeArquivo.current) campoDeArquivo.current.value = "";
      setTentouSalvar(false);
      setAviso({ tom: "sucesso", texto: resultado.frase });
    } finally {
      setSalvando(false);
    }
  }

  /**
   * As setas do teclado nas abas — o padrão de abas da WAI-ARIA.
   *
   * Só a aba ativa fica no ciclo do Tab (`tabIndex -1` nas outras), e a troca é
   * por seta. Sem as setas, quem navega por teclado fica preso na aba de venda
   * e nunca alcança a fiscal: três quartos da ficha ficariam inacessíveis.
   */
  function navegarPorTeclado(evento: KeyboardEvent<HTMLDivElement>) {
    const atual = ABAS.findIndex((a) => a.chave === aba);
    const passo =
      evento.key === "ArrowRight" ? 1 : evento.key === "ArrowLeft" ? -1 : 0;

    let destino = -1;
    if (passo) destino = (atual + passo + ABAS.length) % ABAS.length;
    if (evento.key === "Home") destino = 0;
    if (evento.key === "End") destino = ABAS.length - 1;
    if (destino < 0) return;

    evento.preventDefault();
    setAba(ABAS[destino].chave);
    botoesDasAbas.current[destino]?.focus();
  }

  const painel = `${idDasAbas}-painel`;

  return (
    <div className="pb-4">
      {aviso && (
        <div className="mb-5">
          {/* R9 — banner persistente, nunca toast: flash pode não ser anunciado,
              some na ampliação e não pode ser relido. */}
          <Tarja tom={aviso.tom} onFechar={() => setAviso(null)}>
            {aviso.texto}
          </Tarja>
        </div>
      )}

      <Ficha
        titulo={ehNovo ? "Novo produto" : "Ficha do produto"}
        semPreenchimento
        /* As abas no CABEÇALHO da ficha, e não dentro do corpo: elas governam
           tudo o que está abaixo, e uma tira de abas flutuando no meio do
           conteúdo não diz o que ela troca. */
        acao={
          <div
            role="tablist"
            aria-label="Seções da ficha"
            onKeyDown={navegarPorTeclado}
            className="flex items-center gap-1"
          >
            {ABAS.map((cada, i) => {
              const ativa = cada.chave === aba;
              return (
                <button
                  key={cada.chave}
                  ref={(no) => {
                    botoesDasAbas.current[i] = no;
                  }}
                  type="button"
                  role="tab"
                  id={`${idDasAbas}-${cada.chave}`}
                  aria-selected={ativa}
                  aria-controls={painel}
                  tabIndex={ativa ? 0 : -1}
                  onClick={() => setAba(cada.chave)}
                  className={`inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 text-[11px] ${ETIQUETA} ${FOCO} ${
                    ativa
                      ? "border-fuligem text-fuligem"
                      : "border-transparent text-fuligem-55 hover:text-fuligem"
                  }`}
                >
                  {cada.rotulo}
                  {/*
                    OS DOIS MARCADORES DA ABA, e nenhum deles é só cor. `!` diz
                    "há erro aqui" e `•` diz "há alteração aqui"; o `sr-only` ao
                    lado carrega a mesma informação para quem não vê o glifo —
                    WCAG 1.4.1, a cor nunca é o canal.
                  */}
                  {abasErradas.includes(cada.chave) ? (
                    <>
                      <span aria-hidden="true">!</span>
                      <span className="sr-only">(com erro)</span>
                    </>
                  ) : abasMudadas.includes(cada.chave) ? (
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
          id={painel}
          role="tabpanel"
          aria-labelledby={`${idDasAbas}-${aba}`}
          /* `tabIndex={0}` porque o painel tem conteúdo focável e o padrão ARIA
             pede que ele mesmo receba foco vindo da aba. */
          tabIndex={0}
          className={`p-5 ${FOCO}`}
        >
          {aba === "venda" && (
            <AbaVenda
              forma={forma}
              erros={erros}
              mudar={mudar}
              produto={produto}
              custoInicial={custoInicial}
              erroDoCusto={erroDoCusto}
              aoRebasearEstoque={(valor) => {
                // O estoque salvo pela rota própria deixa de estar pendente: a
                // base acompanha, senão a barra de salvar continuaria dizendo
                // que há alteração e o `PUT` reescreveria o mesmo número.
                setBase((b) => ({ ...b, estoque: valor }));
                setForma((f) => ({ ...f, estoque: valor }));
              }}
            />
          )}

          {aba === "conteudo" && (
            <AbaConteudo
              forma={forma}
              mudar={mudar}
              imagemAtual={produto?.image ?? null}
              arquivo={arquivo}
              recusa={recusaDoArquivo}
              aoEscolher={escolherArquivo}
              campoDeArquivo={campoDeArquivo}
            />
          )}

          {aba === "fiscal" && (
            <AbaFiscal forma={forma} erros={erros} mudar={mudar} />
          )}

          {aba === "seo" && <AbaSeo />}
        </div>
      </Ficha>

      {/*
        A BARRA DE SALVAR — R5. `sticky bottom-0` e não `fixed`: ela pertence ao
        formulário, e a largura dela tem de ser a do conteúdo, não a da janela —
        com o menu lateral de `md` para cima, uma barra fixa começaria debaixo
        do menu.

        NO CADASTRO ELA APARECE SEMPRE, mesmo com o formulário intocado: um
        produto novo não tem "alterações pendentes", tem um botão de criar, e
        escondê-lo até alguém digitar deixaria a tela sem saída aparente.
      */}
      {(sujo || ehNovo) && (
        <div className="sticky bottom-0 z-30 mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-cx border border-fuligem-20 bg-cal-puro px-5 py-3">
          <p className="text-[13px] text-fuligem-55">
            {ehNovo && !sujo
              ? "Preencha nome, preço, estoque e as medidas da caixa."
              : `Alterações não salvas${
                  abasMudadas.length
                    ? ` em ${abasMudadas
                        .map((c) => ABAS.find((a) => a.chave === c)?.rotulo)
                        .join(", ")}`
                    : ""
                }.`}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              DESCARTAR É DESTRUTIVO E PEDE DUAS ETAPAS. Um clique errado num
              "Descartar" de uma etapa apaga meia hora de digitação sem nada
              para desfazer — e R11 pede peso e cor diferentes para o que
              destrói, com o "Continuar editando" entre ele e o dedo.
            */}
            {sujo &&
              (confirmandoDescarte ? (
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
              ))}

            {/* R14 — nada de otimismo: "Salvando…" fica na tela até o servidor
                responder, porque o pior estado não é lento, é "não sei se
                aconteceu". */}
            <Botao onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : ehNovo ? "Cadastrar produto" : "Salvar"}
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * ABA 1 — VENDA
 * ────────────────────────────────────────────────────────────────────────── */

function AbaVenda({
  forma,
  erros,
  mudar,
  produto,
  custoInicial,
  erroDoCusto,
  aoRebasearEstoque,
}: {
  forma: FormularioDoProduto;
  erros: Partial<Record<keyof FormularioDoProduto, string>>;
  mudar: (campo: keyof FormularioDoProduto, valor: string) => void;
  produto: ProdutoDoPainel | null;
  custoInicial: CustoDoProduto | null;
  erroDoCusto: string | null;
  aoRebasearEstoque: (valor: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome"
          required
          value={forma.nome}
          erro={erros.nome ?? null}
          onChange={(e) => mudar("nome", e.target.value)}
          className="sm:col-span-2"
          autoComplete="off"
        />

        <Campo
          rotulo="SKU"
          value={forma.sku}
          onChange={(e) => mudar("sku", e.target.value)}
          spellCheck={false}
          autoComplete="off"
          /*
            A AJUDA DIZ AS DUAS COISAS QUE A OMISSÃO ESCONDE.

            Primeira: o SKU é a chave que casa este registro com o catálogo
            editorial da loja — sem ele o café não aparece na vitrine, e nada na
            tela denunciaria isso.

            Segunda: apagar o conteúdo do campo NÃO apaga o SKU. `corpoDoProduto`
            omite o campo em branco de propósito, porque no backend um SKU vazio
            vira NULL e tirar o café da loja não pode ser efeito colateral de um
            Backspace. Como a omissão é invisível, ela é dita.
          */
          ajuda={`É por ele que a loja acha este café — ${AVISO_SEM_SKU} sem SKU. Deixar em branco mantém o SKU de hoje.`}
        />

        <Campo
          rotulo="Embalagem"
          value={forma.embalagem}
          onChange={(e) => mudar("embalagem", e.target.value)}
          autoComplete="off"
          /* O rótulo visível é "Embalagem" e o campo da API continua sendo
             `size`, herança da loja de camisetas: renomear lá quebraria a
             vitrine e o backend ao mesmo tempo. */
          ajuda="O formato do café: 250 g, Caixa 3×250 g."
        />

        <Campo
          rotulo="Categoria"
          value={forma.categoria}
          onChange={(e) => mudar("categoria", e.target.value)}
          autoComplete="off"
        />

        <Campo
          rotulo="Preço (R$)"
          required
          value={forma.preco}
          erro={erros.preco ?? null}
          onChange={(e) => mudar("preco", e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          /*
            A RODA DO MOUSE NÃO PODE ALTERAR PREÇO — e este é um defeito real do
            formulário legado, que usava `type="number"`. Num campo numérico
            focado, rolar a página muda o valor: quem rola a tela com o cursor
            em cima do campo publica outro preço sem tocar em nada, e a barra de
            salvar aparece dizendo que há alteração pendente sem que ninguém
            tenha alterado.

            O campo aqui é de TEXTO com `inputMode="decimal"` (que já traz o
            teclado numérico no celular e aceita a vírgula do português), o que
            fecha a porta pela raiz. O `onWheel` fica como cinto de segunda
            ordem, para o dia em que alguém o trocar por `number`.
          */
          onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
          ajuda="Use vírgula: 59,90."
        />

        <div className="flex flex-col gap-2">
          <Campo
            rotulo="Estoque (unidades)"
            required
            value={forma.estoque}
            erro={erros.estoque ?? null}
            onChange={(e) => mudar("estoque", e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
          />
          {produto && (
            <SalvarSoOEstoque
              id={produto.product_id}
              valor={forma.estoque}
              aoSalvar={aoRebasearEstoque}
            />
          )}
        </div>
      </div>

      {produto && (
        <>
          <BlocoDoCusto
            id={produto.product_id}
            custoInicial={custoInicial}
            erroDoCusto={erroDoCusto}
            precoDaForma={forma.preco}
          />
          {/* R13 vive aqui — e o bloco existe justamente porque o que ele
              explica é uma AUSÊNCIA: não há arquivar e não há excluir. Ausência
              sem explicação é lida como tela incompleta, e o caminho seguinte é
              abrir o painel antigo e apagar por lá. */}
          <BlocoDoEstado />
        </>
      )}
    </div>
  );
}

/**
 * "Salvar só o estoque" — o atalho que a rota nova tornou possível.
 *
 * POR QUE ELE EXISTE ao lado de um botão "Salvar" que já grava o estoque junto
 * com o resto: porque "entrou mercadoria" é a operação mais frequente desta
 * ficha e a que menos deveria mexer em qualquer outra coisa. O `PUT` reescreve
 * doze colunas por multipart; o `PATCH` mexe numa. Foi por reenviar o
 * formulário inteiro só para ajustar estoque que as medidas do pacote eram
 * apagadas — e o conserto certo, escrito no próprio backend, "é não ter de
 * mandar o resto".
 */
function SalvarSoOEstoque({
  id,
  valor,
  aoSalvar,
}: {
  id: string;
  valor: string;
  aoSalvar: (valor: string) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(
    null,
  );

  const quantidade = Number(valor);
  const podeSalvar = Number.isInteger(quantidade) && quantidade >= 0;

  async function enviar() {
    setSalvando(true);
    setResultado(null);
    try {
      const r = await ajustarEstoque(id, quantidade);
      if (r.ok) {
        aoSalvar(String(quantidade));
        setResultado({ ok: true, texto: r.frase });
      } else {
        setResultado({ ok: false, texto: r.erro });
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Botao variante="secundaria" onClick={enviar} disabled={salvando || !podeSalvar}>
        {salvando ? "Salvando…" : "Salvar só o estoque"}
      </Botao>
      {resultado && (
        <p
          /* `role="status"` e não `alert`: é a confirmação de uma coisa que a
             pessoa acabou de pedir, e interromper o leitor de tela para dizer
             "estoque ajustado" atrapalha quem já seguiu para o campo seguinte. */
          role="status"
          className={`text-[12px] ${resultado.ok ? "text-sucesso" : "text-vermelho"}`}
        >
          {resultado.texto}
        </p>
      )}
    </div>
  );
}

/**
 * O CUSTO — e por que ele tem bloco, rota e botão próprios.
 *
 * `produtos.custo` ficou FORA do `GRANT SELECT` de coluna de 0006 de propósito:
 * a instância Supabase é COMPARTILHADA, e dar a coluna a `authenticated`
 * entregaria a margem da loja a qualquer token da VPS — inclusive de outro
 * projeto. O troco é que nem a admin a lê pelo PostgREST, porque privilégio de
 * coluna é por PAPEL e ela autentica como `authenticated` igual a todo mundo. E
 * `RETURNING *` responde **42501 até para a admin** nesta tabela.
 *
 * Por isso `GET/PATCH /admin/produtos/:id/custo`, rota admin no Express, que
 * conecta como DONO do banco. Nada aqui tenta ler custo pelo caminho normal.
 *
 * QUANDO A LEITURA FALHA, O BLOCO DIZ O QUE FALHOU e não desenha um campo
 * vazio: um "R$ 0,00" que na verdade é "não consegui perguntar" é a mesma
 * mentira que o `<EstadoDaTela>` existe para impedir na lista, e aqui ela
 * viraria uma decisão de margem tomada sobre um número inventado.
 */
function BlocoDoCusto({
  id,
  custoInicial,
  erroDoCusto,
  precoDaForma,
}: {
  id: string;
  custoInicial: CustoDoProduto | null;
  erroDoCusto: string | null;
  precoDaForma: string;
}) {
  const inicial = custoInicial ? String(custoInicial.custo).replace(".", ",") : "";
  const [base, setBase] = useState(inicial);
  const [valor, setValor] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(
    null,
  );

  const recusa = recusaDoCusto(valor);
  const sujo = valor !== base;

  /* A MARGEM USA O PREÇO QUE ESTÁ NO FORMULÁRIO, não o que veio do banco: quem
     está digitando um preço novo quer ver a margem NOVA. É a única leitura
     desta tela que atravessa a fronteira entre dois blocos, e é o que faz o
     custo responder à pergunta que se faz olhando para ele. */
  const conta = margem(
    String(precoDaForma).replace(",", "."),
    String(valor).replace(",", "."),
  );

  async function enviar() {
    setSalvando(true);
    setResultado(null);
    try {
      const r = await salvarCusto(id, valor);
      if (r.ok) {
        setBase(valor);
        setResultado({ ok: true, texto: r.frase });
      } else {
        setResultado({ ok: false, texto: r.erro });
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Ficha titulo="Custo e margem" nivel={3}>
      {erroDoCusto ? (
        <Tarja tom="erro">{erroDoCusto}</Tarja>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              rotulo="Custo (R$)"
              value={valor}
              erro={sujo ? recusa : null}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
              ajuda="Só o painel vê este número. Ele não vai para a loja nem para a nota."
            />

            <div className="flex flex-col gap-1.5">
              <p className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>Margem</p>
              <p data-dado className="text-[15px]">
                {conta
                  ? `${formatarReais(conta.reais)} · ${conta.percentual.toFixed(1)}%`
                  : "—"}
              </p>
              <p className="text-[13px] text-fuligem-55">
                {/* O travessão tem DOIS motivos e eles são diferentes; dizer
                    qual é evita a leitura "a margem é zero". */}
                {conta
                  ? "Sobre o preço que está no formulário."
                  : "Informe custo e preço maiores que zero para calcular."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Botao
              variante="secundaria"
              onClick={enviar}
              disabled={salvando || !sujo || recusa !== null}
            >
              {salvando ? "Salvando…" : "Salvar custo"}
            </Botao>
            {resultado && (
              <p
                role="status"
                className={`text-[12px] ${resultado.ok ? "text-sucesso" : "text-vermelho"}`}
              >
                {resultado.texto}
              </p>
            )}
          </div>
        </div>
      )}
    </Ficha>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * ABA 2 — CONTEÚDO
 * ────────────────────────────────────────────────────────────────────────── */

function AbaConteudo({
  forma,
  mudar,
  imagemAtual,
  arquivo,
  recusa,
  aoEscolher,
  campoDeArquivo,
}: {
  forma: FormularioDoProduto;
  mudar: (campo: keyof FormularioDoProduto, valor: string) => void;
  imagemAtual: string | null;
  arquivo: File | null;
  recusa: string | null;
  aoEscolher: (evento: ChangeEvent<HTMLInputElement>) => void;
  campoDeArquivo: MutableRefObject<HTMLInputElement | null>;
}) {
  const idDoArquivo = useId();
  const idDaRecusa = `${idDoArquivo}-recusa`;

  return (
    <div className="space-y-6">
      {/*
        A RESSALVA VEM PRIMEIRO, e não no rodapé, porque ela muda o que faz
        sentido fazer nesta aba.

        Medido em `lib/catalogo/repositorio.ts`: a vitrine lê quatro campos desta
        API (`product_id`, `sku`, `price`, `quantity`) e desenha o resto a partir
        de `data/catalogo-canastra.json`, versionado e revisado em PR. Foto,
        descrição e notas de sabor da loja vêm de lá. O que se sobe aqui fica
        guardado — e o painel legado já reconstruía três botões que mentiam por
        não dizer isso.
      */}
      <Tarja tom="aviso">
        A loja não lê esta foto nem esta descrição: a página do café é montada
        pelo catálogo editorial versionado. O que atravessa daqui é preço,
        estoque e as medidas da caixa. Estes campos servem ao painel e ao que
        vier a ler o cadastro.
      </Tarja>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={idDoArquivo}
          className={`text-[11px] ${ETIQUETA} text-fuligem-55`}
        >
          Foto
        </label>
        <input
          ref={campoDeArquivo}
          id={idDoArquivo}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          onChange={aoEscolher}
          aria-invalid={recusa ? true : undefined}
          aria-describedby={recusa ? idDaRecusa : undefined}
          className={`min-h-11 rounded-bt border border-fuligem-20 bg-cal-puro px-3 py-2 text-[13px] file:mr-3 file:rounded-bt file:border file:border-fuligem-20 file:bg-cal file:px-3 file:py-1.5 file:text-[11px] file:text-fuligem ${FOCO}`}
        />
        {recusa && (
          <p id={idDaRecusa} className="text-[13px] text-vermelho">
            {recusa}
          </p>
        )}
        <p className="text-[13px] text-fuligem-55">
          JPG, PNG, WebP ou AVIF, até 5 MB. Sem arquivo novo, a foto de hoje fica.
        </p>

        {arquivo && (
          <p role="status" className="text-[13px]">
            Vai subir: <span data-dado>{arquivo.name}</span>
          </p>
        )}

        {imagemAtual && <FotoDeHoje url={imagemAtual} />}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${idDoArquivo}-descricao`}
          className={`text-[11px] ${ETIQUETA} text-fuligem-55`}
        >
          Descrição
        </label>
        {/*
          `<textarea>` CRU E NÃO `<Campo>`: o primitivo aceita só `<input>`, de
          propósito ("`<select>` e `<textarea>` têm outras regras de validação e
          de altura, e um componente que aceita os três vira três componentes
          disfarçados de um"). As classes são as mesmas do <Campo>, menos a
          altura mínima de 44px, que aqui vira altura de leitura.
        */}
        <textarea
          id={`${idDoArquivo}-descricao`}
          value={forma.descricao}
          onChange={(e) => mudar("descricao", e.target.value)}
          rows={6}
          className={`rounded-bt border border-fuligem-20 bg-cal-puro px-3 py-2 text-fuligem placeholder:text-fuligem-55 hover:border-fuligem-55 ${FOCO}`}
        />
        <p className="text-[13px] text-fuligem-55">
          Entra no índice de busca do painel, junto com nome, categoria e
          embalagem.
        </p>
      </div>
    </div>
  );
}

/**
 * A foto que está gravada hoje.
 *
 * `<img>` E NÃO `<Image>` DO NEXT, pela mesma razão da prévia da Vitrine: o
 * `next/image` LANÇA para host fora de `images.remotePatterns`, e o campo
 * `imagem` guarda o que quer que o painel legado tenha gravado ali — URL da
 * Cloudinary na maioria dos casos, caminho relativo em cadastro herdado. Uma
 * miniatura que derruba a ficha inteira é pior que uma miniatura sem
 * otimização, e aqui não há LCP a defender: é uma imagem atrás de senha.
 *
 * E É POR CAUSA DESSE "CAMINHO RELATIVO EM CADASTRO HERDADO" QUE A URL PASSA
 * POR `urlDaImagemDoPainel`. O comentário acima já dizia que o campo guarda as
 * duas coisas, e a `<img>` desenhava a string CRUA: no cadastro herdado o
 * navegador resolvia `/uploads/…` contra a origem do painel, onde não há nada,
 * e a foto vinha quebrada. O legado prefixava com `API_BASE`
 * (`AddedProducts.jsx:145`); a função faz o mesmo, e tem teste.
 *
 * O ENDEREÇO CRU CONTINUA ESCRITO AO LADO, e não o resolvido: é o valor que
 * está no banco, é ele que se compara com o que o outro painel mostra, e trocá-lo
 * pelo prefixado esconderia justamente a diferença que se foi conferir.
 */
function FotoDeHoje({ url }: { url: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="size-24 shrink-0 overflow-hidden rounded-cx border border-fuligem-20 bg-cal">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urlDaImagemDoPainel(url)}
          alt="Foto gravada hoje para este produto"
          className="size-full object-cover object-center"
        />
      </div>
      <p className="min-w-0 break-all text-[12px] text-fuligem-55">
        <span data-dado>{url}</span>
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * ABA 3 — FISCAL
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * As quatro medidas, com o nome de cada uma e a unidade no rótulo.
 *
 * A UNIDADE VAI NO RÓTULO E NÃO NA AJUDA porque é ela que muda o número por mil:
 * um peso digitado em GRAMAS num campo que espera QUILOS cota o frete de uma
 * caixa mil vezes mais pesada, e a Melhor Envio aceita.
 */
const MEDIDAS: {
  campo: "peso" | "largura" | "altura" | "comprimento";
  rotulo: string;
}[] = [
  { campo: "peso", rotulo: "Peso (kg)" },
  { campo: "largura", rotulo: "Largura (cm)" },
  { campo: "altura", rotulo: "Altura (cm)" },
  { campo: "comprimento", rotulo: "Comprimento (cm)" },
];

function AbaFiscal({
  forma,
  erros,
  mudar,
}: {
  forma: FormularioDoProduto;
  erros: Partial<Record<keyof FormularioDoProduto, string>>;
  mudar: (campo: keyof FormularioDoProduto, valor: string) => void;
}) {
  /* O AVISO OLHA A TELA, NÃO O BANCO — ver `medidasDaForma`. Quem corrige o
     peso vê o aviso sumir na hora, em vez de continuar lendo uma acusação já
     resolvida até salvar e recarregar. */
  const noPadrao = medidaEhOPadrao(medidasDaForma(forma));

  return (
    <div className="space-y-6">
      <Ficha titulo="Caixa e frete" nivel={3}>
        <div className="space-y-4">
          {/*
            O AVISO EXISTE PORQUE ESTE É O DEFEITO MEDIDO DESTA TELA, e ele é
            escrito por extenso: o formulário legado enviava estes quatro campos
            SEM TER INPUT PARA NENHUM. `undefined` virava a string "undefined" no
            FormData, o backend não conseguia parsear e aplicava 0,3 kg / 20 / 5
            / 20 cm em TODA edição — um café de 1,2 kg voltava a 0,3 kg quando
            alguém corrigia o preço, e a loja cotava frete errado sem sinal na
            tela. O comentário do arquivo legado dizia que o bug tinha sido
            corrigido.
          */}
          <p className="max-w-[70ch] text-[13px] text-fuligem-55">
            É esta caixa que o cálculo do frete usa —{" "}
            <span data-dado>ShippingController</span> lê os quatro do banco, nunca
            do navegador. Elas são salvas junto com o resto da ficha.
          </p>

          {noPadrao && (
            <Tarja tom="alerta">
              As quatro medidas estão exatamente nos valores padrão (0,3 kg,
              20×5×20 cm). Pode ser a caixa real deste café — ou o rastro do
              formulário antigo, que substituía as medidas a cada edição.
              Confira antes de seguir.
            </Tarja>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {MEDIDAS.map(({ campo, rotulo }) => (
              <Campo
                key={campo}
                rotulo={rotulo}
                required
                value={forma[campo]}
                erro={erros[campo] ?? null}
                onChange={(e) => mudar(campo, e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
              />
            ))}
          </div>
        </div>
      </Ficha>

      <BlocoFiscalPendente />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * ABA 4 — SEO
 * ────────────────────────────────────────────────────────────────────────── */

function AbaSeo() {
  return (
    <Ficha titulo="SEO da página do café" nivel={3}>
      <div className="max-w-[75ch] space-y-3 text-[13px]">
        {/*
          A ABA EXISTE E NÃO TEM CAMPO, e isto é uma decisão, não uma sobra.

          `canastra.produtos` não tem coluna de título, de descrição nem de
          slug — e a página do café não as procuraria: o `generateMetadata` de
          `app/[locale]/(vitrine)/cafes/[slug]/page.tsx` monta título e
          descrição a partir do LOTE editorial (`lote.descricao`, `lote.notas`,
          `lote.sca`, `lote.origem`), traduzido para os três idiomas, e o slug é
          o `slugOriginal` do JSON versionado.

          Desenhar três inputs aqui seria construir exatamente o que a pesquisa
          chama de "botões que mentem" — o gestor escreveria uma meta description
          e o Google continuaria mostrando a de sempre. A ausência, explicada, é
          mais útil que a presença falsa.
        */}
        <p>
          O título, a descrição e o endereço de cada café são montados pela loja
          a partir do catálogo editorial versionado, nos três idiomas — não há
          campo de SEO neste cadastro, nem no banco.
        </p>
        <p className="text-fuligem-55">
          Onde mudar hoje:{" "}
          <span data-dado>data/catalogo-canastra.json</span> (nome, endereço e
          notas) e o dicionário de tradução da vitrine. As duas mudanças passam
          por revisão em PR, que é o que impede um endereço de café mudar sem
          redirecionamento.
        </p>
        <p className="text-fuligem-55">
          Para editar SEO por aqui seriam precisos campos no banco e no contrato
          da API. Está registrado no relatório desta onda.
        </p>
      </div>
    </Ficha>
  );
}
