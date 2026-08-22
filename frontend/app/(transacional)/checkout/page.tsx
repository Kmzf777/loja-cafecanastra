"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Botao, BotaoLink } from "@/components/ui/Botao";
import { BarraFreteGratis } from "@/components/layout/BarraFreteGratis";
import { useSacola } from "@/lib/sacola/sacola";
import { formatarPreco } from "@/lib/catalogo/repositorio";
import { recuperarSessao, type Sessao } from "@/lib/conta/sessao";
import { buscarCep, cepCompleto, formatarCep, limparCep } from "@/lib/cep";
import { formatarCpf, limparCpf, validarCpf } from "@/lib/cpf";
import { validarCupom, type CupomAplicado } from "@/lib/sacola/cupom";
import { descartarChave } from "@/lib/sacola/idempotencia";
import {
  IDS_CARTAO,
  chavePublicaMp,
  montarFormularioDeCartao,
  type DadosDoCartao,
  type FormularioDeCartao,
} from "@/lib/sacola/cartao";
import {
  buscarEndereco,
  buscarPrecosAtuais,
  salvarEndereco,
  cotarFrete,
  pagarComPix,
  pagarComCartao,
  subtotalDosItensCentavos,
  CODIGO_PRECO_MUDOU,
  ErroDoPagamento,
  type Endereco,
  type OpcaoDeFrete,
  type RespostaDoPagamento,
} from "@/lib/sacola/checkout";
import type { ItemDaSacola } from "@/lib/sacola/sacola";
import { eventoPurchase } from "@/lib/analytics";

/**
 * Checkout.
 *
 * Uma página só, na ordem em que as decisões acontecem: endereço → CPF (nota
 * fiscal) → frete → pagamento. Nada de assistente com etapas separadas — a
 * cada tela extra some gente no meio do caminho.
 *
 * PIX E CARTÃO. O cartão só existe quando `NEXT_PUBLIC_MP_PUBLIC_KEY` está
 * definida: sem a chave pública não há como tokenizar o número no navegador, e
 * um rádio "Cartão" que não tokeniza seria botão que não faz nada — o defeito
 * que este projeto veio consertar. O número do cartão NUNCA passa pelo nosso
 * servidor: os campos sensíveis são iframes do Mercado Pago (secure fields do
 * CardForm, ver lib/sacola/cartao.ts) e o que viaja é um token de uso único.
 *
 * O QUE ESTA TELA *NÃO* DECIDE: preço, frete, desconto e estoque. Ela sugere;
 * o servidor relê tudo do banco, reconfere o frete contra uma cotação nova,
 * revalida o cupom e só então cobra. Ver conferirFrete e a reserva de estoque
 * em PaymentController.
 *
 * IDEMPOTÊNCIA: cada tentativa de pagamento manda um `Idempotency-Key`
 * estável (lib/sacola/idempotencia.ts) — reclique e retry recebem o pedido já
 * criado com o ticketUrl, sem segunda cobrança. Recusa definitiva descarta a
 * chave, senão a tentativa seguinte receberia o pedido morto para sempre.
 */

const CAMPO =
  "h-11 w-full border border-fuligem-20 bg-cal-puro px-3 text-[15px] " +
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho";
const ROTULO =
  "block text-[11px] font-semibold uppercase tracking-[0.14em] text-fuligem-55";

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
 * Status de resposta que significam "o pedido nasceu morto: nada ficou cobrado".
 *
 * A FONTE É `backend/src/utils/statusDePedido.js` (GRUPO_CANCELADO: cancelado,
 * rejeitado, reembolsado) — esta é uma cópia de leitura, e estava INCOMPLETA:
 * faltava `reembolsado`. Na prática um pedido recém-criado não volta
 * reembolsado da resposta síncrona do MP, então a falta nunca deu defeito
 * visível; é precisamente por isso que ela sobreviveria calada até o dia em que
 * desse. Cópia que não confere com a fonte é dívida com data marcada.
 *
 * Os equivalentes em inglês continuam porque o campo `status` da resposta cai
 * para o vocabulário cru do MP quando a tradução falha (`statusPt || mpStatus`,
 * PaymentController).
 */
const STATUS_RECUSADO = new Set([
  "rejeitado",
  "cancelado",
  "reembolsado",
  "rejected",
  "cancelled",
  "refunded",
]);

export default function PaginaCheckout() {
  const router = useRouter();
  const { itens: itensDaSacola, limpar } = useSacola();

  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [endereco, setEndereco] = useState<Endereco>(ENDERECO_VAZIO);
  const [cpf, setCpf] = useState("");
  const [fretes, setFretes] = useState<OpcaoDeFrete[] | null>(null);
  const [freteEscolhido, setFreteEscolhido] = useState<OpcaoDeFrete | null>(null);
  const [cotando, setCotando] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pago, setPago] = useState<RespostaDoPagamento | null>(null);

  // Cupom: o desconto exibido vem do /cupons/validar; quem manda é o servidor.
  const [codigoCupom, setCodigoCupom] = useState("");
  const [cupom, setCupom] = useState<CupomAplicado | null>(null);
  const [erroCupom, setErroCupom] = useState<string | null>(null);
  const [validandoCupom, setValidandoCupom] = useState(false);

  /**
   * PREÇOS RELIDOS DEPOIS DE UM 409 DE PREÇO.
   *
   * A sacola guarda `price` no `localStorage` e nunca o revalida; o servidor
   * cobra o preço do banco. Quando o gestor muda um preço com a sacola de
   * alguém aberta, o `process_payment` recusa com 409 em vez de cobrar
   * diferente do que a pessoa viu (`conferirSubtotal`, PaymentController) — e
   * aí ESTA tela precisa mostrar o número novo, senão o cliente reenvia o
   * mesmo valor velho e leva 409 de novo, para sempre.
   *
   * Guardado aqui, e não gravado na sacola, porque é correção de UMA tentativa
   * de pagamento: o que a sacola tem é assunto da vitrine, que relê preço a
   * cada visita. Enquanto este mapa existir, é ele que manda no resumo, no
   * total, na cotação de frete e no subtotal declarado ao servidor.
   */
  const [precosFrescos, setPrecosFrescos] = useState<Record<
    string,
    number
  > | null>(null);

  /** A sacola com os preços corrigidos, quando houver. Tudo na tela lê daqui. */
  const itens = useMemo<ItemDaSacola[]>(() => {
    if (!precosFrescos) return itensDaSacola;
    return itensDaSacola.map((i) =>
      precosFrescos[i.product_id] === undefined
        ? i
        : { ...i, price: precosFrescos[i.product_id] },
    );
  }, [itensDaSacola, precosFrescos]);

  const totalCentavos = subtotalDosItensCentavos(itens);

  // Cartão: só existe com a chave pública no build.
  const temCartao = chavePublicaMp() !== null;
  const [metodo, setMetodo] = useState<"pix" | "cartao">("pix");
  const [cartaoPronto, setCartaoPronto] = useState(false);

  // Comprar exige conta: o pedido precisa de dono. Quem não está logado vai
  // para o login e volta.
  useEffect(() => {
    let vivo = true;
    recuperarSessao().then(async (s) => {
      if (!vivo) return;
      if (!s) {
        router.replace("/account/login?de=/checkout");
        return;
      }
      setSessao(s);
      const salvo = await buscarEndereco(s.accessToken);
      if (salvo && vivo) {
        setEndereco({ ...ENDERECO_VAZIO, ...salvo });
        // Endereço salvo não passa pelo ViaCEP: sobrescrever o que a pessoa
        // já corrigiu numa compra anterior seria regressão silenciosa.
        cepJaBuscado.current = limparCep(salvo.zip_code);
      }
      if (vivo) setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [router]);

  /**
   * ViaCEP: quando o CEP se completa, rua/bairro/cidade/UF se preenchem
   * sozinhos. FALHA É SILENCIOSA de propósito (lib/cep.ts): o serviço é
   * conveniência, e um CEP que ele não conhece continua entregável — a pessoa
   * segue digitando. Campo que o ViaCEP devolve vazio não apaga o que já foi
   * digitado.
   */
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

  const cpfDigitos = limparCpf(cpf);
  const cpfValido = validarCpf(cpfDigitos);

  const descontoCentavos = cupom
    ? Math.min(cupom.descontoCentavos, totalCentavos)
    : 0;
  const freteCentavos = Math.round((freteEscolhido?.price ?? 0) * 100);
  const total = totalCentavos - descontoCentavos + freteCentavos;

  /**
   * A cotação em si, SEMPRE com o cupom corrente.
   *
   * O cupom entra na decisão de frete grátis do servidor (o piso é comparado
   * com o subtotal DESCONTADO — ShippingController). Cotar sem ele arma um
   * beco sem saída: subtotal R$ 160 com piso R$ 149 ganha frete grátis, o
   * cupom de 10% derruba para R$ 144, o conferirFrete recusa o zero com 409 e
   * a recotação sem cupom devolve o grátis de novo. Por isso o código do
   * cupom viaja aqui e no process_payment — os dois lados decidem igual.
   *
   * GUARDA DE CORRIDA: cada cotação leva um id; só a MAIS RECENTE escreve
   * estado. Sem isso, "Calcular frete" seguido de "Aplicar cupom" deixava
   * duas cotações em voo, e a antiga (sem cupom) podia aterrissar por último
   * — oferecendo um frete que o servidor recusaria na cobrança.
   */
  const idDaCotacao = useRef(0);
  /**
   * `itensParaCotar` existe para o caminho do 409 de preço: ele recota logo
   * depois de corrigir os preços, e a `itens` desta closure ainda é a do render
   * anterior (o estado só chega no próximo). Passar a lista explicitamente é o
   * que impede a recotação de decidir frete grátis com o preço velho.
   *
   * Devolve a frase de falha (ou `null`): quem chama pode ANTEPOR o próprio
   * motivo em vez de perdê-lo — `setErro(null)` na entrada apagaria a
   * explicação de quem pediu a recotação.
   */
  async function recotar(
    codigoDoCupom?: string,
    itensParaCotar: ItemDaSacola[] = itens,
  ): Promise<string | null> {
    const meuId = ++idDaCotacao.current;
    setErro(null);
    setCotando(true);
    setFretes(null);
    setFreteEscolhido(null);
    try {
      const opcoes = await cotarFrete(
        endereco.zip_code,
        itensParaCotar,
        codigoDoCupom,
      );
      if (idDaCotacao.current !== meuId) return null; // uma mais nova assumiu
      setFretes(opcoes);
      if (opcoes.length) {
        setFreteEscolhido(opcoes[0]);
        return null;
      }
      const semFrete = "Nenhuma transportadora atende este CEP no momento.";
      setErro(semFrete);
      return semFrete;
    } catch (e) {
      if (idDaCotacao.current !== meuId) return null;
      const falha = e instanceof Error ? e.message : "Erro ao calcular o frete.";
      setErro(falha);
      return falha;
    } finally {
      if (idDaCotacao.current === meuId) setCotando(false);
    }
  }

  async function aoCotar(evento: React.FormEvent) {
    evento.preventDefault();
    if (!sessao) return;
    setErro(null);
    try {
      await salvarEndereco(sessao.accessToken, endereco);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar o endereço.");
      return;
    }
    await recotar(cupom?.codigo);
  }

  async function aoAplicarCupom(evento: React.FormEvent) {
    evento.preventDefault();
    // Enter no campo submete mesmo com o botão desabilitado — mesma razão do
    // guard de `pagando` no cartão.
    if (validandoCupom) return;
    setErroCupom(null);
    setValidandoCupom(true);
    const resultado = await validarCupom(codigoCupom, itens);
    setValidandoCupom(false);
    if (resultado.valido) {
      setCupom(resultado.cupom);
      setCodigoCupom("");
      // O desconto muda a conta do frete grátis → a escolha de frete caduca.
      // Recota já com o cupom novo (o estado `cupom` ainda não re-renderizou,
      // então o código vai explícito) em vez de deixar um frete zerado que o
      // servidor recusaria na cobrança. `cotando` entra na condição porque
      // durante uma cotação em voo `fretes` é null — "cotando" não é "nunca
      // cotou", e a cotação em voo está SEM o cupom novo.
      if (fretes !== null || cotando) await recotar(resultado.cupom.codigo);
    } else {
      // Cupom inválido NÃO trava o fluxo: a frase aparece e o pedido segue
      // sem desconto se a pessoa quiser.
      setErroCupom(resultado.motivo);
    }
  }

  /** Tirar o cupom desfaz o desconto — a cotação volta a ser sem ele. */
  async function aoRemoverCupom() {
    setCupom(null);
    setErroCupom(null);
    if (fretes !== null || cotando) await recotar(undefined);
  }

  /**
   * Desfecho comum aos dois meios.
   *
   * Recusa definitiva (o pedido nasceu 'rejeitado'): erro na tela, sacola
   * INTACTA e chave de idempotência descartada — repetir a chave devolveria o
   * pedido morto para sempre. Nada foi cobrado (o backend devolve o estoque).
   *
   * Sucesso: `purchase` do GA4 UMA vez (a ref segura o React 18 de StrictMode
   * e qualquer re-render), depois a sacola esvazia — nessa ordem, porque o
   * evento precisa dos itens que a limpeza apaga. A CHAVE TAMBÉM É DESCARTADA
   * AQUI: a tentativa acabou. Sem o descarte, uma compra idêntica repetida na
   * mesma sessão (mesmos itens, mesmo frete, sem reload) casaria a assinatura,
   * reusaria a chave e o servidor devolveria o pedido ANTIGO como replay — sem
   * cobrança, sem pedido novo, com a tela dizendo "Pedido recebido". A chave
   * só deve sobreviver a RETRY da mesma tentativa (timeout, rede, 4xx antes de
   * criar pedido), e esses caminhos saem pelo catch, que não passa por aqui.
   */
  const purchaseDisparado = useRef(false);
  async function concluir(resposta: RespostaDoPagamento) {
    if (STATUS_RECUSADO.has(resposta.status)) {
      descartarChave();
      setErro(
        // "ficou cobrado", e não "foi cobrado": o grupo agora inclui
        // `reembolsado`, em que o valor chegou a sair e voltou.
        "O pagamento não foi aprovado. Nenhum valor ficou cobrado — " +
          "confira os dados, tente outro cartão ou pague com Pix.",
      );
      return;
    }
    if (!purchaseDisparado.current) {
      purchaseDisparado.current = true;
      eventoPurchase({
        idTransacao: resposta.orderId,
        valorCentavos: total,
        freteCentavos,
        itens: itens.map((i) => ({
          // A MESMA identidade do add_to_cart e do begin_checkout (skuLoja),
          // senão o funil do GA4 não fecha. Fallback para o id de banco:
          // item antigo no localStorage não carrega `sku`.
          id: i.sku ?? i.product_id,
          nome: i.name,
          precoCentavos: Math.round(Number(i.price) * 100),
          quantidade: Number(i.quantity),
          variante: i.moagem,
        })),
      });
    }
    // Tentativa encerrada com pedido de pé: a próxima compra é OUTRO pedido.
    descartarChave();
    setPago(resposta);
    // A sacola só é esvaziada depois do pagamento aceito: se falhar, a pessoa
    // não perde o que montou.
    await limpar();
  }

  /**
   * O QUE FAZER COM UMA TENTATIVA DE PAGAMENTO QUE FALHOU.
   *
   * Quase todo erro é frase na tela e ponto. O 409 DE PREÇO é diferente: ele
   * diz que o número que esta tela exibiu não é mais o preço da loja, e mostrar
   * a frase sem corrigir nada deixaria o cliente preso — reenviar o mesmo
   * subtotal velho daria o mesmo 409 para sempre, e o botão "Pagar" viraria
   * botão de mentira.
   *
   * Então releem-se os preços na fonte que a vitrine usa (`GET /dashboard`,
   * o mesmo endpoint de `lib/catalogo/repositorio.ts`), o resumo passa a exibir
   * o total novo e a tentativa seguinte já sai com o número certo. Se nem a
   * releitura funcionar, a instrução é recarregar a página — nunca prometer um
   * total que não foi conferido.
   */
  async function tratarFalhaDePagamento(falha: unknown, fraseDeFallback: string) {
    const frase = falha instanceof Error ? falha.message : fraseDeFallback;
    const ehPreco =
      falha instanceof ErroDoPagamento && falha.codigo === CODIGO_PRECO_MUDOU;

    if (!ehPreco) {
      setErro(frase);
      return;
    }

    let precos: Map<string, number>;
    try {
      precos = await buscarPrecosAtuais(itensDaSacola);
    } catch {
      setErro(
        `${frase} Recarregue a página para ver os valores atualizados antes de pagar.`,
      );
      return;
    }

    const mapa: Record<string, number> = {};
    const corrigidos = itensDaSacola.map((i) => {
      const preco = precos.get(i.product_id);
      if (preco === undefined) return i;
      mapa[i.product_id] = preco;
      return { ...i, price: preco };
    });
    setPrecosFrescos(mapa);

    // O cupom foi validado contra o subtotal ANTIGO: revalida, senão o resumo
    // exibe um desconto que o servidor não vai aceitar (e um mínimo de pedido
    // pode ter deixado de ser atingido com a mudança de preço).
    let codigoDoCupom = cupom?.codigo;
    if (cupom) {
      const revalidado = await validarCupom(cupom.codigo, corrigidos);
      if (revalidado.valido) {
        setCupom(revalidado.cupom);
      } else {
        setCupom(null);
        setErroCupom(revalidado.motivo);
        codigoDoCupom = undefined;
      }
    }

    // Preço novo pode cruzar o piso do frete grátis nos dois sentidos: o frete
    // escolhido caducou junto. Recota agora, senão a próxima tentativa levaria
    // o 409 do FRETE logo depois deste.
    const falhaNaCotacao = await recotar(codigoDoCupom, corrigidos);

    const aviso =
      `${frase} Atualizamos o resumo: o subtotal agora é ` +
      `${formatarPreco(subtotalDosItensCentavos(corrigidos))}.`;
    setErro(
      falhaNaCotacao
        ? `${aviso} ${falhaNaCotacao}`
        : `${aviso} Confira e confirme para pagar esse valor.`,
    );
  }

  async function aoPagarComPix() {
    if (pagando) return;
    if (!sessao || !freteEscolhido || !cpfValido) return;
    setErro(null);
    setPagando(true);
    try {
      const resposta = await pagarComPix(sessao.accessToken, {
        itens,
        email: sessao.usuario.email,
        cpf: cpfDigitos,
        endereco,
        frete: freteEscolhido,
        cupom: cupom?.codigo,
      });
      await concluir(resposta);
    } catch (e) {
      await tratarFalhaDePagamento(e, "Não foi possível gerar o Pix.");
    } finally {
      setPagando(false);
    }
  }

  /**
   * O submit do cartão é interceptado pelo SDK (que tokeniza nos iframes) e
   * chega aqui já com o token. A ref existe porque o CardForm é montado num
   * efeito: um callback capturado na montagem veria o CPF e o cupom daquela
   * hora — a ref entrega sempre o render corrente.
   */
  const aoTokenRef = useRef<(dados: DadosDoCartao) => void>(() => {});
  aoTokenRef.current = async (dadosCartao: DadosDoCartao) => {
    // O SDK intercepta o SUBMIT do form, não o clique: Enter no campo de nome
    // dispara mesmo com o botão desabilitado. Uma cobrança já em voo ganha.
    if (pagando) return;
    if (!sessao || !freteEscolhido || !cpfValido) return;
    setErro(null);
    setPagando(true);
    try {
      const resposta = await pagarComCartao(sessao.accessToken, {
        itens,
        email: sessao.usuario.email,
        cpf: cpfDigitos,
        endereco,
        frete: freteEscolhido,
        cupom: cupom?.codigo,
        cartao: dadosCartao,
      });
      await concluir(resposta);
    } catch (e) {
      await tratarFalhaDePagamento(e, "Não foi possível processar o cartão.");
    } finally {
      setPagando(false);
    }
  };

  /**
   * Monta o CardForm quando o método é cartão E há frete (o SDK calcula as
   * parcelas sobre o total, que sem frete não existe). O total muda → remonta:
   * `amount` é fixado na montagem. Desmontar no cleanup é o que impede dois
   * CardForms disputando os mesmos iframes.
   */
  useEffect(() => {
    if (!temCartao || metodo !== "cartao" || !freteEscolhido || pago) return;
    let vivo = true;
    let formulario: FormularioDeCartao | null = null;
    setCartaoPronto(false);
    // Erro da montagem anterior (ou de outro método) não descreve ESTA
    // tentativa de montagem — some antes de começar.
    setErro(null);
    montarFormularioDeCartao({
      valorReais: total / 100,
      aoSubmeter: (dados) => aoTokenRef.current(dados),
      aoErro: (mensagem) => {
        if (vivo) setErro(mensagem);
      },
    })
      .then((f) => {
        if (!vivo) {
          f.desmontar();
          return;
        }
        formulario = f;
        setCartaoPronto(true);
      })
      .catch(() => {
        if (vivo) {
          setErro(
            "Não foi possível carregar o pagamento por cartão. Recarregue a " +
              "página ou pague com Pix.",
          );
        }
      });
    return () => {
      vivo = false;
      formulario?.desmontar();
    };
    // `total` cobre itens, desconto e frete — é o que o amount precisa.
  }, [temCartao, metodo, freteEscolhido, total, pago]);

  if (carregando) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-24 md:px-10">
        <p role="status" className="text-[15px] text-fuligem-55">
          Carregando…
        </p>
      </div>
    );
  }

  // ── Pedido criado ────────────────────────────────────────────────────────
  if (pago) {
    const aprovado = pago.status === "aprovado" || pago.status === "approved";
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
        <h1 className="font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1]">
          Pedido recebido.
        </h1>
        <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-fuligem-80">
          Pedido <span className="font-dado">{pago.orderId.slice(0, 8)}</span>.{" "}
          {pago.ticketUrl
            ? "Assim que o Pix for compensado, o café entra na próxima torra."
            : aprovado
              ? "Pagamento aprovado — o café entra na próxima torra."
              : "O pagamento está em análise; avisamos por e-mail assim que confirmar."}
        </p>
        {pago.ticketUrl ? (
          <div className="mt-8">
            <a
              href={pago.ticketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center rounded-bt bg-vermelho px-6 text-[13px] font-semibold uppercase tracking-[0.08em] text-white hover:bg-vermelho-esc"
            >
              Abrir o Pix para pagar
            </a>
          </div>
        ) : null}
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <BotaoLink href={`/pedido/${pago.orderId}`} variante="secundario">
            Acompanhar pedido
          </BotaoLink>
          <Link
            href="/account"
            className="text-[14px] text-vermelho underline underline-offset-4"
          >
            Ver meus pedidos
          </Link>
        </div>
      </div>
    );
  }

  if (itens.length === 0) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
        <h1 className="font-titulo text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
          Sua sacola está vazia.
        </h1>
        <div className="mt-8">
          <BotaoLink href="/cafes" variante="primario">
            Ver os cafés
          </BotaoLink>
        </div>
      </div>
    );
  }

  const podePagar =
    Boolean(freteEscolhido) && cpfValido && !pagando && (metodo === "pix" || cartaoPronto);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fuligem-55">
        Fechar pedido
      </p>
      <h1 className="mt-5 font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1] tracking-[-0.015em]">
        Checkout
      </h1>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_360px]">
        <div>
          {/* ── Endereço ────────────────────────────────────────────────── */}
          <form onSubmit={aoCotar}>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              Entrega
            </h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cep" className={ROTULO}>
                  CEP
                </label>
                <input
                  id="cep"
                  required
                  inputMode="numeric"
                  autoComplete="postal-code"
                  value={formatarCep(endereco.zip_code)}
                  onChange={(e) =>
                    setEndereco({
                      ...endereco,
                      zip_code: formatarCep(e.target.value),
                    })
                  }
                  className={`${CAMPO} mt-1.5 font-dado`}
                />
                <p className="mt-1.5 text-[12px] text-fuligem-55">
                  O endereço se preenche sozinho pelo CEP.
                </p>
              </div>
              <div>
                <label htmlFor="rua" className={ROTULO}>
                  Rua
                </label>
                <input
                  id="rua"
                  required
                  value={endereco.street}
                  onChange={(e) =>
                    setEndereco({ ...endereco, street: e.target.value })
                  }
                  className={`${CAMPO} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="numero" className={ROTULO}>
                  Número
                </label>
                <input
                  id="numero"
                  required
                  value={endereco.number}
                  onChange={(e) =>
                    setEndereco({ ...endereco, number: e.target.value })
                  }
                  className={`${CAMPO} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="complemento" className={ROTULO}>
                  Complemento
                </label>
                <input
                  id="complemento"
                  value={endereco.complement ?? ""}
                  onChange={(e) =>
                    setEndereco({ ...endereco, complement: e.target.value })
                  }
                  className={`${CAMPO} mt-1.5`}
                />
              </div>
              <div>
                <label htmlFor="bairro" className={ROTULO}>
                  Bairro
                </label>
                <input
                  id="bairro"
                  required
                  value={endereco.neighborhood}
                  onChange={(e) =>
                    setEndereco({ ...endereco, neighborhood: e.target.value })
                  }
                  className={`${CAMPO} mt-1.5`}
                />
              </div>
              <div className="grid grid-cols-[1fr_88px] gap-4">
                <div>
                  <label htmlFor="cidade" className={ROTULO}>
                    Cidade
                  </label>
                  <input
                    id="cidade"
                    required
                    value={endereco.city}
                    onChange={(e) =>
                      setEndereco({ ...endereco, city: e.target.value })
                    }
                    className={`${CAMPO} mt-1.5`}
                  />
                </div>
                <div>
                  <label htmlFor="uf" className={ROTULO}>
                    UF
                  </label>
                  <input
                    id="uf"
                    required
                    maxLength={2}
                    value={endereco.state}
                    onChange={(e) =>
                      setEndereco({
                        ...endereco,
                        state: e.target.value.toUpperCase(),
                      })
                    }
                    className={`${CAMPO} mt-1.5 uppercase`}
                  />
                </div>
              </div>
            </div>

            <Botao
              type="submit"
              variante="secundario"
              disabled={cotando}
              className="mt-6"
            >
              {cotando ? "Calculando…" : "Calcular frete"}
            </Botao>
          </form>

          {/* ── CPF — nota fiscal ───────────────────────────────────────── */}
          <div className="mt-10">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              Nota fiscal
            </h2>
            <div className="mt-4 max-w-[280px]">
              <label htmlFor="cpf" className={ROTULO}>
                CPF
              </label>
              <input
                id="cpf"
                required
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                value={cpf}
                onChange={(e) => setCpf(formatarCpf(e.target.value))}
                aria-describedby="cpf-ajuda"
                aria-invalid={cpfDigitos.length === 11 && !cpfValido}
                className={`${CAMPO} mt-1.5 font-dado`}
              />
              <p id="cpf-ajuda" className="mt-1.5 text-[12px] text-fuligem-55">
                Usamos o CPF para emitir a nota fiscal do pedido.
              </p>
              {cpfDigitos.length === 11 && !cpfValido ? (
                <p role="alert" className="mt-1.5 text-[13px] text-vermelho">
                  Este CPF não confere. Confira os dígitos.
                </p>
              ) : null}
            </div>
          </div>

          {/* ── Frete ───────────────────────────────────────────────────── */}
          {fretes?.length ? (
            <fieldset className="mt-10">
              {/* "Opções de entrega", não "Entrega": o formulário de endereço
                  logo acima já é a região "Entrega" — duas regiões homônimas
                  obrigam quem navega por landmarks a visitar ambas. */}
              <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
                Opções de entrega
              </legend>
              <div className="mt-4 grid gap-2">
                {fretes.map((f) => (
                  <label
                    key={`${f.id}-${f.name}`}
                    className={`flex cursor-pointer items-center justify-between gap-4 border px-4 py-3 transition-colors ${
                      freteEscolhido?.id === f.id
                        ? "border-fuligem"
                        : "border-fuligem-20 hover:border-fuligem"
                    }`}
                  >
                    <span className="flex items-center gap-3 text-[14px]">
                      <input
                        type="radio"
                        name="frete"
                        checked={freteEscolhido?.id === f.id}
                        onChange={() => setFreteEscolhido(f)}
                        className="accent-[var(--color-vermelho)]"
                      />
                      {f.name}
                      {f.days ? (
                        <span className="text-fuligem-55">
                          · {f.days} {f.days === 1 ? "dia" : "dias"}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-dado text-[14px]">
                      {/* `gratis` é o marcador do SERVIDOR de que o subtotal
                          atingiu o piso — não um preço que deu zero. */}
                      {f.gratis
                        ? "Frete grátis"
                        : f.price > 0
                          ? formatarPreco(Math.round(f.price * 100))
                          : "Grátis"}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {/* ── Pagamento ───────────────────────────────────────────────── */}
          <fieldset className="mt-10">
            <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
              Pagamento
            </legend>
            <div className="mt-4 grid gap-2">
              <label
                className={`flex cursor-pointer items-center gap-3 border px-4 py-3 text-[14px] transition-colors ${
                  metodo === "pix"
                    ? "border-fuligem"
                    : "border-fuligem-20 hover:border-fuligem"
                }`}
              >
                <input
                  type="radio"
                  name="metodo-pagamento"
                  checked={metodo === "pix"}
                  onChange={() => {
                    setMetodo("pix");
                    // Erro do outro método não descreve este.
                    setErro(null);
                  }}
                  className="accent-[var(--color-vermelho)]"
                />
                Pix
                <span className="text-fuligem-55">· aprovação na hora</span>
              </label>

              {/* Sem NEXT_PUBLIC_MP_PUBLIC_KEY o rádio nem existe — oferecer
                  cartão sem poder tokenizar seria botão de mentira. */}
              {temCartao ? (
                <label
                  className={`flex cursor-pointer items-center gap-3 border px-4 py-3 text-[14px] transition-colors ${
                    metodo === "cartao"
                      ? "border-fuligem"
                      : "border-fuligem-20 hover:border-fuligem"
                  }`}
                >
                  <input
                    type="radio"
                    name="metodo-pagamento"
                    checked={metodo === "cartao"}
                    onChange={() => {
                      setMetodo("cartao");
                      setErro(null);
                    }}
                    className="accent-[var(--color-vermelho)]"
                  />
                  Cartão de crédito
                  <span className="text-fuligem-55">· em até 12x</span>
                </label>
              ) : null}
            </div>

            {metodo === "cartao" ? (
              !freteEscolhido ? (
                <p className="mt-4 text-[13px] text-fuligem-55">
                  Calcule o frete para liberar o pagamento por cartão — as
                  parcelas dependem do total.
                </p>
              ) : (
                /* Os ids vêm de IDS_CARTAO: o SDK acha os campos por id.
                   Número, validade e CVV são DIVS — viram iframes do Mercado
                   Pago (secure fields); o dado sensível nunca toca nosso DOM. */
                <form
                  id={IDS_CARTAO.form}
                  className="mt-6 grid gap-4"
                  onSubmit={(e) => {
                    // Antes de o SDK montar não há listener interceptando: um
                    // Enter aqui seria submit NATIVO — página recarregando no
                    // meio do checkout. Depois de pronto, quem trata é o SDK.
                    if (!cartaoPronto) e.preventDefault();
                  }}
                >
                  <div>
                    <span className={ROTULO} id="rotulo-numero-cartao">
                      Número do cartão
                    </span>
                    <div
                      id={IDS_CARTAO.cardNumber}
                      role="group"
                      aria-labelledby="rotulo-numero-cartao"
                      className={`${CAMPO} mt-1.5`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className={ROTULO} id="rotulo-validade-cartao">
                        Validade
                      </span>
                      <div
                        id={IDS_CARTAO.expirationDate}
                        role="group"
                        aria-labelledby="rotulo-validade-cartao"
                        className={`${CAMPO} mt-1.5`}
                      />
                    </div>
                    <div>
                      <span className={ROTULO} id="rotulo-cvv-cartao">
                        Cód. de segurança
                      </span>
                      <div
                        id={IDS_CARTAO.securityCode}
                        role="group"
                        aria-labelledby="rotulo-cvv-cartao"
                        className={`${CAMPO} mt-1.5`}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor={IDS_CARTAO.cardholderName} className={ROTULO}>
                      Nome impresso no cartão
                    </label>
                    <input
                      id={IDS_CARTAO.cardholderName}
                      autoComplete="cc-name"
                      className={`${CAMPO} mt-1.5`}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={IDS_CARTAO.issuer} className={ROTULO}>
                        Banco emissor
                      </label>
                      <select
                        id={IDS_CARTAO.issuer}
                        className={`${CAMPO} mt-1.5`}
                      />
                    </div>
                    <div>
                      <label htmlFor={IDS_CARTAO.installments} className={ROTULO}>
                        Parcelas
                      </label>
                      {/* O SDK preenche com o que o emissor oferecer (até
                          12x); a primeira opção é 1x — o padrão. */}
                      <select
                        id={IDS_CARTAO.installments}
                        className={`${CAMPO} mt-1.5`}
                      />
                    </div>
                  </div>
                  {/* Campos que o SDK exige mas a tela já conhece: o CPF vem
                      do bloco da nota fiscal, o e-mail da sessão. Escondidos
                      para não pedir o mesmo dado duas vezes. */}
                  <select
                    id={IDS_CARTAO.identificationType}
                    className="hidden"
                    aria-hidden
                    tabIndex={-1}
                  />
                  <input
                    type="hidden"
                    id={IDS_CARTAO.identificationNumber}
                    value={cpfDigitos}
                    readOnly
                  />
                  <input
                    type="hidden"
                    id={IDS_CARTAO.cardholderEmail}
                    value={sessao?.usuario.email ?? ""}
                    readOnly
                  />
                  {!cartaoPronto ? (
                    <p role="status" className="text-[13px] text-fuligem-55">
                      Preparando o pagamento seguro…
                    </p>
                  ) : null}
                </form>
              )
            ) : null}
          </fieldset>

          {erro ? (
            <p
              role="alert"
              className="mt-6 border-l-2 border-vermelho bg-cal-puro py-2 pl-3 text-[14px]"
            >
              {erro}
            </p>
          ) : null}
        </div>

        {/* ── Resumo ─────────────────────────────────────────────────────── */}
        <aside className="h-fit border border-fuligem-20 p-6">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-fuligem-55">
            Resumo
          </h2>

          <ul className="mt-4 space-y-2">
            {itens.map((i) => (
              <li
                key={i.product_id}
                className="flex justify-between gap-3 text-[13px]"
              >
                <span className="min-w-0">
                  {i.quantity}× {i.name}
                </span>
                <span className="shrink-0 font-dado">
                  {formatarPreco(
                    Math.round(Number(i.price) * 100) * Number(i.quantity),
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/* Mesma conta do servidor: o piso é comparado com o subtotal já
              descontado pelo cupom. */}
          <BarraFreteGratis
            className="mt-4 border-t border-fuligem-20 pt-3"
            descontoCentavos={descontoCentavos}
          />

          {/* ── Cupom ──────────────────────────────────────────────────── */}
          <div className="mt-4 border-t border-fuligem-20 pt-3">
            {cupom ? (
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span>
                  Cupom <span className="font-dado">{cupom.codigo}</span>
                  {cupom.descricao ? (
                    <span className="text-fuligem-55"> · {cupom.descricao}</span>
                  ) : null}
                </span>
                <button
                  onClick={aoRemoverCupom}
                  className="shrink-0 text-vermelho underline underline-offset-4"
                >
                  Remover
                </button>
              </div>
            ) : (
              <form onSubmit={aoAplicarCupom}>
                <label htmlFor="cupom" className={ROTULO}>
                  Cupom
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="cupom"
                    value={codigoCupom}
                    onChange={(e) => {
                      setCodigoCupom(e.target.value.toUpperCase());
                      setErroCupom(null);
                    }}
                    autoComplete="off"
                    className={`${CAMPO} min-w-0 flex-1 font-dado uppercase`}
                  />
                  <Botao
                    type="submit"
                    variante="secundario"
                    disabled={validandoCupom || !codigoCupom.trim()}
                    className="h-11 shrink-0 px-4 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {validandoCupom ? "…" : "Aplicar"}
                  </Botao>
                </div>
              </form>
            )}
            {erroCupom ? (
              <p role="alert" className="mt-2 text-[13px] text-vermelho">
                {erroCupom}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex justify-between border-t border-fuligem-20 pt-3 text-[14px]">
            <span>Subtotal</span>
            <span className="font-dado">{formatarPreco(totalCentavos)}</span>
          </div>

          {descontoCentavos > 0 ? (
            <div className="mt-3 flex justify-between text-[14px]">
              <span>Desconto</span>
              <span className="font-dado">
                −{formatarPreco(descontoCentavos)}
              </span>
            </div>
          ) : null}

          <div className="mt-3 flex justify-between text-[14px]">
            <span>Frete</span>
            <span className="font-dado">
              {freteEscolhido
                ? freteEscolhido.gratis
                  ? "Frete grátis"
                  : freteEscolhido.price > 0
                    ? formatarPreco(freteCentavos)
                    : "Grátis"
                : "—"}
            </span>
          </div>

          <div className="mt-3 flex items-baseline justify-between border-t border-fuligem-20 pt-3">
            <span className="text-[15px] font-semibold">Total</span>
            <span className="font-dado text-[20px]">{formatarPreco(total)}</span>
          </div>

          <div className="mt-6">
            {metodo === "pix" ? (
              <Botao
                variante="primario"
                disabled={!podePagar}
                onClick={aoPagarComPix}
                className="w-full disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
              >
                {pagando ? "Gerando Pix…" : "Pagar com Pix"}
              </Botao>
            ) : (
              /* `form=` submete o formulário do cartão daqui de fora; o SDK
                 intercepta o submit, tokeniza nos iframes e devolve o token
                 ao aoSubmeter — o clique nunca vê número de cartão. */
              <Botao
                type="submit"
                form={IDS_CARTAO.form}
                variante="primario"
                disabled={!podePagar}
                className="w-full disabled:cursor-not-allowed disabled:bg-fuligem-20 disabled:text-fuligem-55"
              >
                {pagando ? "Processando…" : "Pagar com cartão"}
              </Botao>
            )}
          </div>

          {!freteEscolhido ? (
            <p className="mt-3 text-[13px] text-fuligem-55">
              Calcule o frete para liberar o pagamento.
            </p>
          ) : !cpfValido ? (
            <p className="mt-3 text-[13px] text-fuligem-55">
              Informe o CPF para liberar o pagamento — é o dado da nota fiscal.
            </p>
          ) : null}

          <p className="mt-6 text-[13px] text-fuligem-55">
            {temCartao
              ? "Pagamento por Pix ou cartão de crédito."
              : "Pagamento por Pix."}
          </p>
        </aside>
      </div>
    </div>
  );
}
