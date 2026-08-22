"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Botao } from "@/components/ui/Botao";
import { MOAGENS, type Moagem, type PesoGramas } from "@/lib/catalogo/tipos";
import { formatarPreco, precoParaLeitor } from "@/lib/catalogo/repositorio";
import { recuperarSessao, type Sessao } from "@/lib/conta/sessao";
import { buscarCep, cepCompleto, formatarCep, limparCep } from "@/lib/cep";
// O MESMO módulo do checkout: máscara progressiva e dígitos verificadores da
// Receita, já cobertos por lib/cpf.test.ts. Nada de segunda implementação.
import { formatarCpf, limparCpf, validarCpf } from "@/lib/cpf";
import { clienteNavegador } from "@/lib/supabase/cliente";
import { dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import { LOCALE_PADRAO, type Locale } from "@/lib/i18n/tipos";
import { textosDoClube } from "./conteudo";
import { buscarEndereco, type Endereco } from "@/lib/sacola/checkout";
import {
  FREQUENCIAS_DIAS,
  assinarClube,
  economiaPorEnvio,
  montarCorpoDeAssinatura,
  preSelecaoDaQuery,
  precoPorEnvio,
  varianteDoClube,
  type FalhaDaAssinatura,
  type FrequenciaDias,
  type OpcaoDoClube,
} from "@/lib/clube";

/**
 * O wizard REAL do Clube — estetica.md §7.4: fluxo de 3 passos com barra de
 * progresso em Martian Mono (`PASSO 1 DE 3`), fechando na etiqueta de
 * despacho. Substitui a apresentação estática que a página manteve enquanto
 * "o wizard com estado ainda não existe" (a pendência registrada lá fecha
 * aqui, na Onda 3J).
 *
 * Passo 1  café + moagem + quantidade (só as linhas com `assinatura`)
 * Passo 2  frequência — 15 / 30 / 45 dias
 * Passo 3  endereço (ViaCEP preenche; entrega recorrente exige endereço
 *          PRÓPRIO, congelado na adesão) + resumo-etiqueta + Assinar
 *
 * "Assinar" faz o POST /clube/assinar e redireciona ao `init_point` do
 * Mercado Pago — é LÁ que o cliente autoriza a cobrança recorrente. Sem
 * sessão, vai ao login com ?de=/clube e volta — com o RASCUNHO
 * (`CHAVE_DO_RASCUNHO`) reidratando os três passos, endereço incluído.
 *
 * O `locale` ENTRA POR PROP, e é o que fecha a pendência declarada aqui: o
 * texto inteiro deste formulário — rótulos, erros de validação, títulos de
 * passo, botões e o resumo — vinha de constantes em português e saía assim nos
 * três idiomas. Esta é a tela em que o cliente AUTORIZA COBRANÇA RECORRENTE:
 * texto ambíguo aqui custa dinheiro, e texto em outra língua custa a adesão
 * inteira. As frases vivem em `conteudo.ts`, ao lado da página; os rótulos de
 * moagem continuam vindo do dicionário, para PDP, PLP e wizard dizerem a mesma
 * palavra.
 *
 * O foco acompanha a troca de passo (`tituloDoPasso`): o fieldset desmonta
 * inteiro, e sem isso o teclado ficava perdido no `body`.
 *
 * SUPERFÍCIE MATA (§4.1): vermelho sobre mata é 2,0:1 — proibido. Seleção e
 * CTA saem em Cal; o foco visível idem.
 *
 * O PREÇO EXIBIDO É CORTESIA: quem decide os -10% é o servidor, sobre o preço
 * do banco (ClubeController). lib/clube.test.ts fixa que as duas fórmulas
 * coincidem.
 */

const PESOS: PesoGramas[] = [250, 500, 1000];

/**
 * O título do passo. Recebe foco por script (ver `tituloDoPasso`), nunca por
 * Tab — daí o `tabIndex={-1}` no elemento e o anel de foco visível aqui: foco
 * invisível é pior que foco nenhum.
 */
const TITULO_DO_PASSO =
  "text-[19px] font-semibold focus-visible:outline-2 " +
  "focus-visible:outline-offset-[3px] focus-visible:outline-cal";

const ROTULO_MATA =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-cal/60";
const CAMPO_MATA =
  "h-11 w-full border border-cal/30 bg-cal-puro px-3 text-[15px] text-fuligem " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-cal";

const ENDERECO_VAZIO: Endereco = {
  zip_code: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};

/**
 * O RASCUNHO DO WIZARD. Quem chega sem sessão só descobre no "Assinar", no fim
 * do passo 3 — e a ida ao login desmonta a página: sem isto, os três passos
 * (inclusive o endereço inteiro digitado à mão) voltavam VAZIOS, e só café e
 * moagem sobreviviam pela query. Guardar antes do `router.push` e reidratar na
 * montagem faz a volta do login cair exatamente onde a pessoa parou.
 *
 * `sessionStorage` e não `localStorage`: é rascunho de uma sessão de navegação,
 * não preferência guardada — e ele é CONSUMIDO na leitura, para uma visita
 * futura a /clube não ressuscitar um endereço antigo do nada.
 */
const CHAVE_DO_RASCUNHO = "canastra:clube:rascunho";

type Rascunho = {
  passo: 1 | 2 | 3;
  slug: string;
  moagem: Moagem;
  peso: PesoGramas;
  quantidade: number;
  frequencia: FrequenciaDias;
  /** Com máscara, como está na tela — a volta do login reencontra o campo igual. */
  cpf: string;
  endereco: Endereco;
};

/**
 * A recusa exibida, com a procedência da frase.
 *
 * `doServidor` decide como ela é DESENHADA fora do português: a frase do
 * backend é pt-BR por decisão (spec §1) e específica demais para se jogar
 * fora, mas mostrá-la crua no meio de uma página em inglês faz o site parecer
 * quebrado. Ver `FalhaDaAssinatura` em lib/clube.ts.
 */
type ErroExibido = { texto: string; doServidor: boolean };

/**
 * O CPF que a conta JÁ tem (`canastra.clientes.cpf`), para quem comprou avulso
 * antes não redigitar o número na adesão — a mesma cortesia do endereço salvo
 * logo acima. A política `clientes_dono_le` (0006) garante que só o dono lê a
 * própria linha.
 *
 * FALHA É SILENCIOSA e devolve "": isto é conveniência, não regra. Supabase mal
 * configurado, RLS negando, rede fora — em todos os casos a pessoa digita o CPF
 * e assina do mesmo jeito. Quem decide de verdade é o servidor, que grava o
 * número e recusa a adesão sem ele.
 */
async function lerCpfDoCadastro(userId: string): Promise<string> {
  try {
    const { data, error } = await clienteNavegador()
      .from("clientes")
      .select("cpf")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return "";
    return data?.cpf ?? "";
  } catch {
    return "";
  }
}

function guardarRascunho(rascunho: Rascunho) {
  try {
    sessionStorage.setItem(CHAVE_DO_RASCUNHO, JSON.stringify(rascunho));
  } catch {
    // Armazenamento bloqueado (aba anônima, cota): o fluxo segue igual, só
    // sem a cortesia da volta. Nunca derruba o caminho do login.
  }
}

function consumirRascunho(): Rascunho | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_DO_RASCUNHO);
    sessionStorage.removeItem(CHAVE_DO_RASCUNHO);
    if (!bruto) return null;
    const lido = JSON.parse(bruto) as Partial<Rascunho> | null;
    // Só o que tem a forma esperada volta; o resto é lixo de versão antiga e
    // reidratar meio estado seria pior que recomeçar.
    if (!lido || typeof lido !== "object" || !lido.endereco || !lido.slug) {
      return null;
    }
    return lido as Rascunho;
  } catch {
    return null;
  }
}

/**
 * A recusa na tela.
 *
 * Em português a frase do servidor É a resposta. Fora dele, a tela diz a
 * genérica traduzida e mostra a do servidor abaixo, rotulada e marcada
 * `lang="pt-BR"` — o leitor de tela troca de voz em vez de soletrar português
 * com fonemas ingleses, e o visitante entende que aquilo é a loja falando, não
 * a página quebrada.
 *
 * FORA DO COMPONENTE de propósito: definida dentro, ela seria um tipo novo a
 * cada render e o React remontaria o alerta a cada tecla digitada — o que
 * refaz o anúncio do `role="alert"` do zero.
 */
function Recusa({
  erro,
  textos,
  locale,
}: {
  erro: ErroExibido;
  textos: ReturnType<typeof textosDoClube>["wizard"]["erros"];
  locale: Locale;
}) {
  const separar = erro.doServidor && locale !== LOCALE_PADRAO;
  return (
    <div role="alert" className="mt-4 text-[14px] text-cal">
      <p>{separar ? textos.falha : erro.texto}</p>
      {separar ? (
        <p className="mt-1.5 text-[13px] text-cal/70">
          {textos.respostaDaLoja} <span lang="pt-BR">{erro.texto}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * A classe de TODO botão de escolha do wizard — café, moagem, peso e
 * frequência saem daqui.
 *
 * `min-h-12`: sem piso de altura, `py-2.5` com 13px fechava em 41,5 px, abaixo
 * dos 44 que o §10 exige. Eram 15 alvos somando os três idiomas, e num caminho
 * que fatura recorrente — errar o toque aqui não perde uma venda, perde a
 * assinatura inteira. O piso vive na função, e não em cada `<button>`, porque
 * é justamente o que os quatro grupos têm em comum.
 */
function botaoDeOpcao(ativo: boolean, existe = true) {
  return [
    "min-h-12 border px-3 py-2.5 text-left text-[13px] transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-cal",
    ativo ? "border-cal bg-cal text-fuligem" : "border-cal/30 hover:border-cal",
    existe
      ? ""
      : "cursor-not-allowed border-cal/20 text-cal/30 line-through hover:border-cal/20",
  ].join(" ");
}

export function AssinaturaWizard({
  opcoes,
  locale,
}: {
  opcoes: OpcaoDoClube[];
  locale: Locale;
}) {
  const router = useRouter();

  const t = textosDoClube(locale).wizard;
  /**
   * "Grão" e "Moído" vêm do DICIONÁRIO, e não de `conteudo.ts`, porque o mesmo
   * par de palavras rotula o seletor da PDP e o filtro da PLP. Duas fontes para
   * o mesmo rótulo é como um site passa a chamar a mesma coisa de dois nomes.
   */
  const rotuloDaMoagem = dicionario(locale).catalogo.moagem;

  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [slug, setSlug] = useState(opcoes[0]?.slug ?? "");
  const [moagem, setMoagem] = useState<Moagem>("grao");
  const [peso, setPeso] = useState<PesoGramas>(250);
  const [quantidade, setQuantidade] = useState(1);
  const [frequencia, setFrequencia] = useState<FrequenciaDias>(30);
  const [cpf, setCpf] = useState("");
  const [endereco, setEndereco] = useState<Endereco>(ENDERECO_VAZIO);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  // "já perguntamos ao servidor" — separado de `sessao` para o aviso de login
  // do passo 3 não PISCAR para quem está logado enquanto a checagem corre.
  const [sessaoConferida, setSessaoConferida] = useState(false);
  const [assinando, setAssinando] = useState(false);
  const [erro, setErro] = useState<ErroExibido | null>(null);

  const opcao = useMemo(
    () => opcoes.find((o) => o.slug === slug) ?? opcoes[0],
    [opcoes, slug],
  );

  /**
   * A MONTAGEM DECIDE ENTRE DUAS ORIGENS, nesta ordem:
   *
   *   1. o rascunho da ida ao login (sessionStorage), que traz TUDO — é a
   *      volta de quem já tinha preenchido os três passos;
   *   2. a pré-seleção da PDP (`?cafe=&moagem=`), lida do location e não de
   *      useSearchParams porque a página é estática (revalidate) e o hook
   *      exigiria um limite de Suspense só para dois parâmetros opcionais.
   *
   * O rascunho vence: ele é mais específico e mais recente que a query.
   */
  useEffect(() => {
    const rascunho = consumirRascunho();
    if (rascunho) {
      setSlug(rascunho.slug);
      setMoagem(rascunho.moagem);
      setPeso(rascunho.peso);
      setQuantidade(rascunho.quantidade);
      setFrequencia(rascunho.frequencia);
      if (rascunho.cpf) setCpf(rascunho.cpf);
      setEndereco({ ...ENDERECO_VAZIO, ...rascunho.endereco });
      setPasso(rascunho.passo);
      return;
    }
    const pre = preSelecaoDaQuery(
      new URLSearchParams(window.location.search),
      opcoes,
    );
    if (pre.cafe) setSlug(pre.cafe);
    if (pre.moagem) setMoagem(pre.moagem);
  }, [opcoes]);

  // Sessão: além de decidir o destino do "Assinar", preenche o endereço salvo
  // e o CPF do cadastro — quem já comprou não redigita rua, CEP nem CPF para
  // assinar café. Os dois campos só entram se estiverem VAZIOS: o rascunho da
  // volta do login (e o que a pessoa já digitou) vence o que veio do servidor.
  useEffect(() => {
    let vivo = true;
    recuperarSessao().then(async (s) => {
      if (!vivo) return;
      setSessaoConferida(true);
      if (!s) return;
      setSessao(s);
      const [salvo, cpfSalvo] = await Promise.all([
        buscarEndereco(s.accessToken),
        lerCpfDoCadastro(s.usuario.userId),
      ]);
      if (!vivo) return;
      if (salvo) {
        setEndereco((atual) =>
          atual.zip_code ? atual : { ...ENDERECO_VAZIO, ...salvo },
        );
      }
      if (cpfSalvo) setCpf((atual) => atual || formatarCpf(cpfSalvo));
    });
    return () => {
      vivo = false;
    };
  }, []);

  // ViaCEP: CEP completo preenche rua/bairro/cidade/UF; falha é silenciosa e
  // nada apaga o que a pessoa já digitou (mesma regra do checkout).
  const cepJaBuscado = useRef("");
  useEffect(() => {
    const cep = limparCep(endereco.zip_code);
    if (!cepCompleto(cep) || cep === cepJaBuscado.current) return;
    cepJaBuscado.current = cep;
    let vivo = true;
    buscarCep(cep).then((achado) => {
      if (!vivo || !achado) return;
      setEndereco((atual) => ({
        ...atual,
        street: achado.street || atual.street,
        neighborhood: achado.neighborhood || atual.neighborhood,
        city: achado.city || atual.city,
        state: achado.state || atual.state,
      }));
    });
    return () => {
      vivo = false;
    };
  }, [endereco.zip_code]);

  const variante = varianteDoClube(opcao, moagem, peso);

  const moagensValidas = useMemo(
    () => new Set(opcao?.variantes.map((v) => v.moagem)),
    [opcao],
  );
  const pesosValidos = useMemo(
    () =>
      new Set(
        opcao?.variantes.filter((v) => v.moagem === moagem).map((v) => v.pesoGramas),
      ),
    [opcao, moagem],
  );

  // Combinação que a troca de café/moagem invalidou volta para a mais próxima
  // disponível — o wizard nunca fica parado num estado invendável.
  useEffect(() => {
    if (!opcao) return;
    if (!moagensValidas.has(moagem)) {
      setMoagem(opcao.variantes[0]?.moagem ?? "grao");
    }
  }, [opcao, moagem, moagensValidas]);
  useEffect(() => {
    if (pesosValidos.size && !pesosValidos.has(peso)) {
      setPeso([...pesosValidos][0]);
    }
  }, [pesosValidos, peso]);

  /**
   * O FOCO ACOMPANHA O PASSO. Trocar de passo desmonta o fieldset inteiro, e o
   * foco de quem apertou "Continuar" caía no `body`: para teclado e leitor de
   * tela, a página simplesmente ficava muda e o próximo Tab recomeçava do topo
   * do documento. O contador "Passo N de 3" não resolve (não é região viva) e a
   * barra é `aria-hidden`. Então o título do passo novo recebe o foco — com
   * `tabIndex={-1}` para poder recebê-lo sem entrar na ordem de tabulação — e
   * o leitor anuncia onde a pessoa está.
   *
   * `passoAnterior` existe para NÃO roubar o foco na montagem: chegar em
   * /clube e ter o foco puxado para o meio da página seria o problema oposto.
   */
  const tituloDoPasso = useRef<HTMLLegendElement>(null);
  const passoAnterior = useRef(passo);
  useEffect(() => {
    if (passoAnterior.current === passo) return;
    passoAnterior.current = passo;
    tituloDoPasso.current?.focus();
  }, [passo]);

  const esgotado = !variante || variante.estoque === 0;
  const teto =
    variante && variante.aoVivo && variante.estoque > 0
      ? Math.min(20, variante.estoque)
      : 20;
  useEffect(() => {
    setQuantidade((q) => Math.min(q, teto));
  }, [teto]);

  const enderecoCompleto =
    cepCompleto(endereco.zip_code) &&
    endereco.street.trim() &&
    endereco.number.trim() &&
    endereco.city.trim() &&
    endereco.state.trim();

  const cpfDigitos = limparCpf(cpf);
  const cpfValido = validarCpf(cpfDigitos);

  const porEnvio = variante ? precoPorEnvio(variante.precoCentavos, quantidade) : 0;
  const economia = variante ? economiaPorEnvio(variante.precoCentavos, quantidade) : 0;

  /** Recusa nascida AQUI: sempre no idioma da página. */
  function recusar(texto: string) {
    setErro({ texto, doServidor: false });
  }

  async function aoAssinar() {
    if (!variante || esgotado) return;
    setErro(null);

    // Contingência (API fora): sem preço do banco não se promete cobrança.
    if (!variante.aoVivo) {
      recusar(t.erros.semLoja);
      return;
    }
    if (!enderecoCompleto) {
      recusar(t.erros.endereco);
      return;
    }
    /**
     * O CPF É PARADA OBRIGATÓRIA, e não capricho de formulário: cada cobrança
     * do Clube vira pedido de venda no Bling, e o ERP recusa pedido sem
     * contato identificado — uma assinatura sem CPF cobraria todo ciclo e
     * nunca emitiria nota. O servidor também recusa (400 CPF_MISSING); a
     * conferência aqui só evita a ida inútil e diz o motivo na hora.
     */
    if (!cpfValido) {
      recusar(t.erros.cpf);
      return;
    }

    // Assinar exige conta — a assinatura precisa de dono para aparecer na
    // conta e ser cancelável. O login devolve para cá, e o rascunho garante
    // que a volta encontre os três passos como estavam (inclusive o endereço,
    // que a query nunca carregou).
    const s = sessao ?? (await recuperarSessao());
    if (!s) {
      guardarRascunho({
        passo,
        slug: opcao?.slug ?? slug,
        moagem,
        peso,
        quantidade,
        frequencia,
        cpf,
        endereco,
      });
      /**
       * O `?de=` VOLTA PARA A /clube DO IDIOMA EM QUE A PESSOA ESTAVA. Cravar
       * "/clube" mandava quem entrou por /en/clube de volta ao português no
       * meio da adesão — e o rascunho reidratava três passos numa página que
       * ela não sabe ler. O login é pt-BR por decisão (spec §1) e por isso o
       * caminho dele não passa por `href()`; o destino da volta passa.
       */
      const volta = encodeURIComponent(href(locale, "/clube"));
      router.push(`/account/login?de=${volta}`);
      return;
    }

    setAssinando(true);
    try {
      const { initPoint } = await assinarClube(
        s.accessToken,
        montarCorpoDeAssinatura({
          variante,
          quantidade,
          frequenciaDias: frequencia,
          cpf: cpfDigitos,
          endereco,
        }),
        fetch,
        { falha: t.erros.falha, semInitPoint: t.erros.semInitPoint },
      );
      // A autorização acontece NO Mercado Pago; a volta cai em
      // /account?assinatura=confirmada (back_url do preapproval).
      window.location.assign(initPoint);
    } catch (e) {
      const falha = e as Partial<FalhaDaAssinatura>;
      setErro({
        texto: falha?.message || t.erros.falha,
        // Só a frase que o servidor mandou é pt-BR garantido; qualquer outra
        // coisa que caia aqui (rede, JSON quebrado) sai no idioma da página.
        doServidor: falha?.doServidor === true,
      });
      setAssinando(false);
    }
  }

  if (!opcoes.length) {
    // Catálogo sem linha assinável (contingência extrema): a página editorial
    // continua de pé e o wizard simplesmente não aparece.
    return null;
  }

  return (
    <div className="mt-14 max-w-[720px]">
      {/* Barra de progresso — §7.4: Martian Mono, PASSO N DE 3. O contador é
          região viva: a barra abaixo é decorativa (aria-hidden), então é esta
          linha que anuncia o avanço para quem não vê a tela. */}
      <p
        aria-live="polite"
        className="font-dado text-[12px] uppercase tracking-[0.1em] text-juta"
      >
        {t.passoDeTres(passo)}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-px bg-cal/20" aria-hidden>
        {[1, 2, 3].map((n) => (
          <div key={n} className={`h-[3px] ${n <= passo ? "bg-cal" : "bg-mata"}`} />
        ))}
      </div>

      {passo === 1 ? (
        <fieldset className="mt-8">
          <legend ref={tituloDoPasso} tabIndex={-1} className={TITULO_DO_PASSO}>
            {t.passo1.titulo}
          </legend>

          <p className={`mt-6 ${ROTULO_MATA}`}>{t.passo1.cafe}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {opcoes.map((o) => (
              <button
                key={o.slug}
                type="button"
                onClick={() => setSlug(o.slug)}
                aria-pressed={opcao?.slug === o.slug}
                className={botaoDeOpcao(opcao?.slug === o.slug)}
              >
                <span className="block text-[14px] font-semibold">{o.nome}</span>
                <span
                  className={`mt-1 block text-[12px] ${
                    opcao?.slug === o.slug ? "text-fuligem/70" : "text-cal/60"
                  }`}
                >
                  {o.notas.join(" · ")}
                </span>
              </button>
            ))}
          </div>

          <p className={`mt-6 ${ROTULO_MATA}`}>{t.passo1.moagem}</p>
          {/* §5.5: combinação inexistente é DESABILITADA, nunca escondida.
              Duas colunas fixas desde que a moagem virou grão ou moído: com
              dois botões, `sm:grid-cols-3` deixava um deles órfão na linha. */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {MOAGENS.map((m) => {
              const existe = moagensValidas.has(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMoagem(m)}
                  disabled={!existe}
                  aria-pressed={moagem === m}
                  title={existe ? undefined : t.passo1.semEsteCafe}
                  className={botaoDeOpcao(moagem === m, existe)}
                >
                  {rotuloDaMoagem[m]}
                </button>
              );
            })}
          </div>

          <p className={`mt-6 ${ROTULO_MATA}`}>{t.passo1.peso}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PESOS.map((g) => {
              const existe = pesosValidos.has(g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setPeso(g)}
                  disabled={!existe}
                  aria-pressed={peso === g}
                  className={`font-dado ${botaoDeOpcao(peso === g, existe)}`}
                >
                  {/* Grama e quilo se escrevem igual nos três idiomas: é
                      unidade do SI, não texto a traduzir. */}
                  {g === 1000 ? "1 kg" : `${g} g`}
                </button>
              );
            })}
          </div>

          <p className={`mt-6 ${ROTULO_MATA}`}>{t.passo1.quantidade}</p>
          <div className="mt-3 flex items-center border border-cal/30 w-fit">
            <button
              type="button"
              onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
              aria-label={t.passo1.diminuir}
              className="h-12 w-12 text-[18px] leading-none hover:bg-cal/10"
            >
              −
            </button>
            <span aria-live="polite" className="w-10 text-center font-dado text-[15px]">
              {quantidade}
            </span>
            <button
              type="button"
              onClick={() => setQuantidade((q) => Math.min(teto, q + 1))}
              disabled={quantidade >= teto}
              aria-label={t.passo1.aumentar}
              className="h-12 w-12 text-[18px] leading-none hover:bg-cal/10 disabled:cursor-not-allowed disabled:text-cal/30"
            >
              +
            </button>
          </div>

          {esgotado ? (
            <p role="status" className="mt-4 text-[14px] text-cal/70">
              {t.passo1.esgotado}
            </p>
          ) : variante ? (
            <p className="mt-4 font-dado text-[15px]">
              {t.passo1.porEnvio(formatarPreco(porEnvio))}{" "}
              <span className="text-juta">
                {t.passo1.economia(formatarPreco(economia))}
              </span>
            </p>
          ) : null}

          <div className="mt-8">
            <Botao
              variante="primarioEscuro"
              disabled={esgotado}
              onClick={() => setPasso(2)}
              className="disabled:cursor-not-allowed disabled:bg-cal/20 disabled:text-cal/50"
            >
              {t.botoes.continuar}
            </Botao>
          </div>
        </fieldset>
      ) : null}

      {passo === 2 ? (
        <fieldset className="mt-8">
          <legend ref={tituloDoPasso} tabIndex={-1} className={TITULO_DO_PASSO}>
            {t.passo2.titulo}
          </legend>
          {/* A frase é a MESMA da FAQ desta página, e por obrigação: a versão
              anterior prometia "adiar um envio sem cancelar" e não existe porta
              para adiar em lugar nenhum — quem pausa é o Mercado Pago. */}
          <p className="mt-2 text-[15px] leading-relaxed text-cal/80">
            {t.passo2.pausa}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {FREQUENCIAS_DIAS.map((dias) => (
              <button
                key={dias}
                type="button"
                onClick={() => setFrequencia(dias)}
                aria-pressed={frequencia === dias}
                className={`font-dado ${botaoDeOpcao(frequencia === dias)}`}
              >
                {t.passo2.aCada(dias)}
              </button>
            ))}
          </div>
          <div className="mt-8 flex gap-3">
            <Botao variante="secundario" onClick={() => setPasso(1)}>
              {t.botoes.voltar}
            </Botao>
            <Botao variante="primarioEscuro" onClick={() => setPasso(3)}>
              {t.botoes.continuar}
            </Botao>
          </div>
        </fieldset>
      ) : null}

      {passo === 3 ? (
        <div className="mt-8 grid gap-10 md:grid-cols-[1fr_auto]">
          <fieldset>
            <legend ref={tituloDoPasso} tabIndex={-1} className={TITULO_DO_PASSO}>
              {t.passo3.titulo}
            </legend>
            <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-cal/70">
              {t.passo3.explicacao}
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="clube-cep" className={ROTULO_MATA}>
                  {t.passo3.cep}
                </label>
                <input
                  id="clube-cep"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={formatarCep(endereco.zip_code)}
                  onChange={(e) =>
                    setEndereco({ ...endereco, zip_code: formatarCep(e.target.value) })
                  }
                  className={`mt-2 ${CAMPO_MATA}`}
                />
              </div>
              <div>
                <label htmlFor="clube-numero" className={ROTULO_MATA}>
                  {t.passo3.numero}
                </label>
                <input
                  id="clube-numero"
                  value={endereco.number}
                  onChange={(e) => setEndereco({ ...endereco, number: e.target.value })}
                  className={`mt-2 ${CAMPO_MATA}`}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="clube-rua" className={ROTULO_MATA}>
                  {t.passo3.rua}
                </label>
                <input
                  id="clube-rua"
                  autoComplete="address-line1"
                  value={endereco.street}
                  onChange={(e) => setEndereco({ ...endereco, street: e.target.value })}
                  className={`mt-2 ${CAMPO_MATA}`}
                />
              </div>
              <div>
                <label htmlFor="clube-complemento" className={ROTULO_MATA}>
                  {t.passo3.complemento}
                </label>
                <input
                  id="clube-complemento"
                  value={endereco.complement ?? ""}
                  onChange={(e) =>
                    setEndereco({ ...endereco, complement: e.target.value })
                  }
                  className={`mt-2 ${CAMPO_MATA}`}
                />
              </div>
              <div>
                <label htmlFor="clube-bairro" className={ROTULO_MATA}>
                  {t.passo3.bairro}
                </label>
                <input
                  id="clube-bairro"
                  value={endereco.neighborhood}
                  onChange={(e) =>
                    setEndereco({ ...endereco, neighborhood: e.target.value })
                  }
                  className={`mt-2 ${CAMPO_MATA}`}
                />
              </div>
              <div>
                <label htmlFor="clube-cidade" className={ROTULO_MATA}>
                  {t.passo3.cidade}
                </label>
                <input
                  id="clube-cidade"
                  autoComplete="address-level2"
                  value={endereco.city}
                  onChange={(e) => setEndereco({ ...endereco, city: e.target.value })}
                  className={`mt-2 ${CAMPO_MATA}`}
                />
              </div>
              <div>
                <label htmlFor="clube-uf" className={ROTULO_MATA}>
                  {t.passo3.uf}
                </label>
                <input
                  id="clube-uf"
                  maxLength={2}
                  autoComplete="address-level1"
                  value={endereco.state}
                  onChange={(e) =>
                    setEndereco({ ...endereco, state: e.target.value.toUpperCase() })
                  }
                  className={`mt-2 ${CAMPO_MATA}`}
                />
              </div>
            </div>

            {/* ── CPF — nota fiscal ─────────────────────────────────────────
                Mesma explicação do checkout ("para a nota fiscal"), porque é
                exatamente o mesmo motivo: cada envio do Clube emite nota, e o
                ERP recusa pedido sem contato identificado. Quem já tem CPF no
                cadastro encontra o campo PREENCHIDO (ver `lerCpfDoCadastro`) e
                não digita nada. Em inglês e espanhol a explicação diz o que a
                sigla é — a sigla fica, porque é o nome do documento. */}
            <div className="mt-8 max-w-[280px]">
              <label htmlFor="clube-cpf" className={ROTULO_MATA}>
                {t.passo3.cpf}
              </label>
              <input
                id="clube-cpf"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                value={cpf}
                onChange={(e) => setCpf(formatarCpf(e.target.value))}
                aria-describedby="clube-cpf-ajuda"
                aria-invalid={cpfDigitos.length === 11 && !cpfValido}
                className={`mt-2 font-dado ${CAMPO_MATA}`}
              />
              <p id="clube-cpf-ajuda" className="mt-2 text-[12px] text-cal/60">
                {t.passo3.cpfAjuda}
              </p>
              {cpfDigitos.length === 11 && !cpfValido ? (
                <p role="alert" className="mt-1.5 text-[13px] text-cal">
                  {t.passo3.cpfInvalido}
                </p>
              ) : null}
            </div>
          </fieldset>

          {/* Resumo em forma de etiqueta de despacho (§7.4). */}
          <div className="h-fit w-full max-w-[360px] border border-cal bg-mata p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Clube da Canastra
            </p>
            <hr className="mt-4 border-cal/30" />
            <dl className="mt-4 space-y-2 font-dado text-[14px]">
              <div className="flex justify-between gap-4">
                <dt className="text-cal/70">{t.resumo.cafe}</dt>
                <dd>{opcao?.nome}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-cal/70">{t.resumo.moagem}</dt>
                <dd>{rotuloDaMoagem[moagem]}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-cal/70">{t.resumo.peso}</dt>
                <dd>
                  {quantidade > 1 ? `${quantidade} × ` : ""}
                  {peso === 1000 ? "1 kg" : `${peso} g`}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-cal/70">{t.resumo.frequencia}</dt>
                <dd>{t.resumo.aCada(frequencia)}</dd>
              </div>
              <div
                className="flex justify-between gap-4 border-t border-cal/30 pt-3 text-[16px]"
                aria-label={t.resumo.porEnvioLeitor(precoParaLeitor(porEnvio))}
              >
                <dt>{t.resumo.porEnvio}</dt>
                <dd>{formatarPreco(porEnvio)}</dd>
              </div>
            </dl>
            <p className="mt-2 font-dado text-[12px] text-juta">
              {t.resumo.economiaEEntrega(formatarPreco(economia))}
            </p>
            <p className="mt-5 text-[14px] text-cal/80">{t.resumo.autorizacao}</p>
            {/* Dito ANTES do clique, não depois: a assinatura precisa de dono,
                e descobrir isso só no "Assinar" é a hora errada. O que já foi
                preenchido volta com a pessoa (ver `guardarRascunho`). */}
            {sessaoConferida && !sessao ? (
              <p className="mt-3 text-[13px] leading-relaxed text-cal/70">
                {t.resumo.precisaDeConta}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-3">
              <Botao
                variante="primarioEscuro"
                onClick={aoAssinar}
                disabled={assinando || esgotado}
                className="w-full disabled:cursor-not-allowed disabled:bg-cal/20 disabled:text-cal/50"
              >
                {assinando ? t.botoes.assinando : t.botoes.assinar}
              </Botao>
              <Botao
                variante="secundario"
                onClick={() => setPasso(2)}
                disabled={assinando}
                className="w-full"
              >
                {t.botoes.voltar}
              </Botao>
            </div>
            {erro ? (
              <Recusa erro={erro} textos={t.erros} locale={locale} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
