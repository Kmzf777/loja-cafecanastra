/**
 * Cartão de crédito — SDK v2 do Mercado Pago, tokenização no navegador.
 *
 * POR QUE O SDK ENTRA POR SCRIPT TAG, E SÓ AQUI: o número do cartão nunca pode
 * tocar o nosso servidor (PCI). O CardForm do SDK monta os campos sensíveis em
 * IFRAMES do próprio Mercado Pago (secure fields) e troca o número por um
 * `token` de uso único — é esse token que o `process_payment` repassa. O
 * carregamento é dinâmico e sob demanda: o script só entra quando a página de
 * checkout pede, e a página só pede quando `NEXT_PUBLIC_MP_PUBLIC_KEY` existe.
 * Sem a env, o rádio "Cartão" nem aparece — botão que não tokeniza é botão que
 * não faz nada, e essa mentira é o que este projeto veio consertar.
 *
 * (Há um `@mercadopago/sdk-react` no package.json, usado pelo painel legado.
 * A vitrine não o importa de propósito: ele embute o carregamento num
 * componente React de contrato próprio, e o que o checkout precisa é do
 * cardForm cru, com os elementos e o ciclo de vida sob nosso controle.)
 *
 * ERRO É TRADUZIDO POR CÓDIGO, NUNCA POR TEXTO: o texto do gateway muda entre
 * versões e vem em inglês; o código é contrato — a mesma lição da tabela de
 * erros do GoTrue em lib/conta/sessao.ts.
 */

export const URL_SDK_MP = "https://sdk.mercadopago.com/js/v2";

/** O que o cardForm devolve em getCardFormData — só o que o checkout usa. */
export type DadosDoCartao = {
  token: string;
  paymentMethodId: string;
  issuerId: string;
  /** Vem string do SDK ("1"); o checkout converte para número no corpo. */
  installments: string;
  identificationNumber: string;
  identificationType: string;
  amount: string;
};

type InstanciaCardForm = {
  unmount: () => void;
  getCardFormData: () => DadosDoCartao;
};

type ClienteMp = { cardForm: (config: unknown) => InstanciaCardForm };

type ConstrutorMp = new (
  chavePublica: string,
  opcoes?: { locale?: string },
) => ClienteMp;

declare global {
  interface Window {
    MercadoPago?: ConstrutorMp;
  }
}

/**
 * A chave pública, ou `null` — e `null` significa "cartão não existe na loja".
 * `NEXT_PUBLIC_*` é resolvida em tempo de build e embutida no bundle.
 */
export function chavePublicaMp(): string | null {
  return process.env.NEXT_PUBLIC_MP_PUBLIC_KEY?.trim() || null;
}

let sdkCarregando: Promise<ConstrutorMp> | null = null;

/**
 * Injeta o script do SDK uma única vez (promise cacheada). Falha de rede
 * LIMPA o cache: a próxima tentativa injeta de novo em vez de repetir a
 * promessa rejeitada para sempre.
 */
export function carregarSdkMp(): Promise<ConstrutorMp> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("O SDK do Mercado Pago é só do navegador."));
  }
  if (window.MercadoPago) return Promise.resolve(window.MercadoPago);
  if (sdkCarregando) return sdkCarregando;

  sdkCarregando = new Promise<ConstrutorMp>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = URL_SDK_MP;
    script.async = true;
    script.onload = () => {
      if (window.MercadoPago) resolve(window.MercadoPago);
      else reject(new Error("O SDK do Mercado Pago carregou sem expor o construtor."));
    };
    script.onerror = () => {
      sdkCarregando = null;
      script.remove();
      reject(new Error("Não foi possível carregar o SDK do Mercado Pago."));
    };
    document.head.appendChild(script);
  });
  return sdkCarregando;
}

/** Onde o security.js do Mercado Pago publica o identificador da sessão. */
export const URL_SECURITY_MP = "https://www.mercadopago.com/v2/security.js";

/**
 * Carrega o script de fingerprint do Mercado Pago.
 *
 * SEPARADO DO SDK DE PROPÓSITO: o SDK v2 tokeniza o cartão e só entra quando
 * há `NEXT_PUBLIC_MP_PUBLIC_KEY`; este aqui não depende de chave nenhuma e
 * vale também para Pix, porque o motor de risco lê o device em qualquer meio
 * de pagamento.
 *
 * NÃO REJEITA NUNCA. Bloqueador de script é cenário corriqueiro, e um
 * checkout que morresse por não carregar o fingerprint trocaria aprovação por
 * conversão. Falhou, segue sem — `deviceIdDoNavegador()` devolve string vazia
 * e o corpo do pagamento sai sem o campo.
 *
 * "NÃO REJEITA NUNCA" é sobre não LANÇAR — não é sobre desistir de coletar.
 * As duas coisas precisam valer ao mesmo tempo: por isso, igual a
 * `carregarSdkMp`, o `onerror` LIMPA o cache antes de resolver. Sem isso, uma
 * falha passageira (rede instável, bloqueador ligado por um instante) deixava
 * `securityCarregando` cacheada como "resolvida sem device id" para sempre —
 * e a montagem seguinte do checkout (troca de página, nova visita à sacola)
 * herdava essa promessa morta em vez de tentar de novo.
 *
 * A CSP já libera www.mercadopago.com em script-src (next.config.mjs).
 */
let securityCarregando: Promise<void> | null = null;

export function carregarSecurityMp(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (securityCarregando) return securityCarregando;

  securityCarregando = new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = URL_SECURITY_MP;
    script.setAttribute("view", "checkout");
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      securityCarregando = null;
      script.remove();
      resolve();
    };
    document.head.appendChild(script);
  });
  return securityCarregando;
}

/** O identificador da sessão, ou string vazia se o script não carregou. */
export function deviceIdDoNavegador(): string {
  if (typeof window === "undefined") return "";
  return (
    (window as unknown as { MP_DEVICE_SESSION_ID?: string })
      .MP_DEVICE_SESSION_ID || ""
  );
}

/**
 * Ids dos elementos que o CardForm controla. Constante COMPARTILHADA com a
 * página de checkout: o SDK acha os campos por id, e um id digitado errado nos
 * dois lados falha em silêncio — numa constante só, não há dois lados.
 */
export const IDS_CARTAO = {
  form: "form-cartao",
  cardNumber: "cartao-numero",
  expirationDate: "cartao-validade",
  securityCode: "cartao-cvv",
  cardholderName: "cartao-nome",
  issuer: "cartao-emissor",
  installments: "cartao-parcelas",
  identificationType: "cartao-tipo-doc",
  identificationNumber: "cartao-cpf",
  cardholderEmail: "cartao-email",
} as const;

/**
 * A tabela de tradução — chave é o código do gateway, nunca o texto.
 * 2xx = campo vazio na tokenização; E30x/3xx = valor que não confere.
 */
const ERROS_MP: Record<string, string> = {
  "205": "Digite o número do cartão.",
  "208": "Digite a validade do cartão.",
  "209": "Digite a validade do cartão.",
  "212": "Informe o CPF do titular do cartão.",
  "213": "Informe o CPF do titular do cartão.",
  "214": "Informe o CPF do titular do cartão.",
  "220": "Escolha o banco emissor do cartão.",
  "221": "Digite o nome impresso no cartão.",
  "224": "Digite o código de segurança do cartão.",
  E301: "O número do cartão não confere. Confira e tente de novo.",
  E302: "O código de segurança do cartão não confere. Confira e tente de novo.",
  "316": "O nome do titular não pôde ser aceito. Digite como está impresso no cartão.",
  "322": "O CPF do titular não confere. Confira os números.",
  "323": "O CPF do titular não confere. Confira os números.",
  "324": "O CPF do titular não confere. Confira os números.",
  "325": "A validade do cartão não confere. Confira mês e ano.",
  "326": "A validade do cartão não confere. Confira mês e ano.",
};

const ERRO_MP_PADRAO =
  "Não conseguimos validar os dados do cartão. Confira os campos e tente de " +
  "novo — ou pague com Pix.";

/** Extrai códigos dos três formatos em que o SDK entrega a causa. */
function codigosDe(erro: unknown): string[] {
  if (Array.isArray(erro)) return erro.flatMap(codigosDe);
  if (typeof erro !== "object" || erro === null) return [];
  const d = erro as { code?: unknown; cause?: unknown };
  const proprios =
    typeof d.code === "string" || typeof d.code === "number" ? [String(d.code)] : [];
  return [...proprios, ...codigosDe(d.cause)];
}

/** Frase de loja para um erro do gateway; fallback honesto para o resto. */
export function traduzirErroMp(erro: unknown): string {
  for (const codigo of codigosDe(erro)) {
    if (ERROS_MP[codigo]) return ERROS_MP[codigo];
  }
  return ERRO_MP_PADRAO;
}

export type FormularioDeCartao = { desmontar: () => void };

/**
 * O cliente do SDK é um por chave, cacheado no módulo: instanciar
 * `new MercadoPago(...)` a cada montagem do CardForm recriava estado interno
 * do SDK (device fingerprint, sessão) sem nenhum ganho — a chave não muda
 * dentro de um build.
 */
let clienteMp: ClienteMp | null = null;

async function obterClienteMp(): Promise<ClienteMp> {
  if (clienteMp) return clienteMp;
  const chave = chavePublicaMp();
  if (!chave) {
    throw new Error("NEXT_PUBLIC_MP_PUBLIC_KEY não configurada — sem cartão.");
  }
  const MercadoPago = await carregarSdkMp();
  clienteMp = new MercadoPago(chave, { locale: "pt-BR" });
  return clienteMp;
}

/**
 * SÓ EXISTE UM CardForm POR VEZ, e a fila é quem garante isso.
 *
 * A página remonta o formulário quando o total muda (efeito com cleanup), e a
 * montagem é assíncrona: duas trocas rápidas de total disparavam a montagem B
 * antes de a A terminar, e o `desmontar()` da A — chamado pelo cleanup do
 * efeito — podia arrancar os iframes que a B tinha acabado de criar. A fila
 * serializa as montagens (a B só começa quando a A assentou) e a instância
 * corrente é desmontada AQUI, antes de criar a próxima — o cleanup do efeito
 * vira redundância inofensiva: desmontar duas vezes é no-op.
 */
let instanciaCorrente: InstanciaCardForm | null = null;
let filaDeMontagem: Promise<unknown> = Promise.resolve();

function desmontarInstancia(instancia: InstanciaCardForm | null) {
  if (!instancia) return;
  try {
    instancia.unmount();
  } catch {
    // O SDK lança se o form já saiu do DOM — e desmontar o que já se foi é
    // exatamente o estado que queríamos.
  }
  if (instanciaCorrente === instancia) instanciaCorrente = null;
}

/**
 * Monta o CardForm sobre os elementos de `IDS_CARTAO` (que já precisam estar
 * no DOM — a página chama isto num efeito, depois de renderizar a seção).
 *
 * `amount` é fixado na montagem — o SDK calcula as parcelas sobre ele — então
 * a página REMONTA quando o total muda (frete ou cupom trocado). O fluxo de
 * submissão é do SDK: ele intercepta o submit do form, tokeniza nos iframes e
 * chama `aoSubmeter` com o token e os metadados; nós nunca vemos o número.
 */
export function montarFormularioDeCartao(opcoes: {
  valorReais: number;
  aoSubmeter: (dados: DadosDoCartao) => void;
  aoErro: (mensagem: string) => void;
}): Promise<FormularioDeCartao> {
  const trabalho = filaDeMontagem.then(() => montar(opcoes));
  // A fila nunca guarda rejeição: uma montagem que falhou (SDK fora do ar)
  // não pode condenar todas as seguintes ao mesmo erro.
  filaDeMontagem = trabalho.catch(() => {});
  return trabalho;
}

async function montar(opcoes: {
  valorReais: number;
  aoSubmeter: (dados: DadosDoCartao) => void;
  aoErro: (mensagem: string) => void;
}): Promise<FormularioDeCartao> {
  const mp = await obterClienteMp();

  // Uma corrente ainda de pé aqui é a montagem anterior cujo cleanup do
  // efeito ainda não rodou (troca rápida de total): sai antes da nova entrar.
  desmontarInstancia(instanciaCorrente);

  let instancia: InstanciaCardForm | null = null;
  instancia = mp.cardForm({
    amount: String(opcoes.valorReais),
    // Secure fields: número, validade e CVV viram iframes do MP dentro das
    // divs indicadas — o dado sensível nunca existe no nosso DOM.
    iframe: true,
    form: {
      id: IDS_CARTAO.form,
      cardNumber: { id: IDS_CARTAO.cardNumber, placeholder: "0000 0000 0000 0000" },
      expirationDate: { id: IDS_CARTAO.expirationDate, placeholder: "MM/AA" },
      securityCode: { id: IDS_CARTAO.securityCode, placeholder: "CVV" },
      cardholderName: { id: IDS_CARTAO.cardholderName, placeholder: "Como está no cartão" },
      issuer: { id: IDS_CARTAO.issuer, placeholder: "Banco emissor" },
      installments: { id: IDS_CARTAO.installments, placeholder: "Parcelas" },
      identificationType: { id: IDS_CARTAO.identificationType, placeholder: "Documento" },
      identificationNumber: { id: IDS_CARTAO.identificationNumber, placeholder: "CPF" },
      cardholderEmail: { id: IDS_CARTAO.cardholderEmail, placeholder: "E-mail" },
    },
    callbacks: {
      onFormMounted: (erro: unknown) => {
        if (erro) opcoes.aoErro(traduzirErroMp(erro));
      },
      onCardTokenReceived: (erro: unknown) => {
        if (erro) opcoes.aoErro(traduzirErroMp(erro));
      },
      onSubmit: (evento: { preventDefault: () => void }) => {
        evento.preventDefault();
        const dados = instancia?.getCardFormData();
        if (!dados?.token) {
          // Sem token não há o que cobrar; o detalhe (campo vazio, número
          // errado) já chegou por onCardTokenReceived quando o SDK o soube.
          opcoes.aoErro(ERRO_MP_PADRAO);
          return;
        }
        opcoes.aoSubmeter(dados);
      },
    },
  });

  instanciaCorrente = instancia;

  return {
    // Desmonta ESTA instância (não "a corrente"): se uma montagem mais nova
    // já a substituiu, o cleanup atrasado do efeito antigo vira no-op em vez
    // de arrancar os iframes da sucessora.
    desmontar: () => {
      desmontarInstancia(instancia);
      instancia = null;
    },
  };
}
