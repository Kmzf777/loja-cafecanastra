import { useCallback, useRef, useState } from "react";
import { toast } from "react-toastify";

import { API_BASE } from "../../../api";
import { corpoDaConfig, fraseDeErro } from "./whatsappContrato";

/**
 * As quatro ações de escrita da tela de WhatsApp — salvar a configuração,
 * criar os templates na Meta, mandar um teste — e as quatro leituras, no molde
 * de `useBlingAcoes.js`.
 *
 * O QUE ESTE HOOK GARANTE, e que é fácil errar escrevendo à mão:
 *
 * 1. TRAVA DE DUPLO CLIQUE NUM `ref`, NÃO NO ESTADO. `setState` é assíncrono:
 *    dois cliques no mesmo tick leem o mesmo estado "livre" e disparam duas
 *    requisições. Com o `ref` a segunda encontra a marca da primeira e
 *    desiste. Aqui isso não é luxo: "Criar na Meta" clicado duas vezes manda
 *    catorze criações de template contra um endpoint com limite de taxa por
 *    conta, e "Enviar teste" duas vezes gasta duas conversas pagas.
 *    A trava é POR AÇÃO — salvar a configuração não tranca o botão de teste.
 *
 * 2. A FRASE DO SERVIDOR CHEGA INTEIRA, pelo toast E pela tarja. Ver
 *    `fraseDeErro` em `whatsappContrato.js`: as mensagens de 503 (o que falta
 *    preencher), 502 (o que a Meta respondeu, já redigido pelo
 *    `whatsappClient`) e 400 (qual campo veio inválido) foram escritas para
 *    este gestor ler. O toast some em 2s e é o aviso do canto do olho; a
 *    tarja é onde a frase pode ser lida com calma.
 *
 * 3. NADA DA RESPOSTA VAI PARA O `console`. O `console.error` daqui leva a
 *    frase que nós escrevemos, nunca o corpo: a resposta de `/config` carrega
 *    as máscaras e a de `/mensagens` carrega os quatro últimos dígitos de
 *    telefone de cliente. Nenhum dos dois precisa estar no DevTools de quem
 *    abrir a tela — e `console.error(corpo)` é o jeito mais fácil de pôr o
 *    conteúdo de uma tela administrativa num log de navegador.
 *
 * 4. NENHUM CABEÇALHO NOVO. `allowedHeaders` do CORS é
 *    `["Content-Type", "Authorization", "Accept"]`; um `X-CSRF-Token` aqui
 *    quebraria o PREFLIGHT, e o erro apareceria como CORS — dez minutos de
 *    investigação na direção errada (`api.js:13-18`).
 *
 * `authFetch` vem do `authContext` e exige URL COMPLETA (`${API_BASE}/...`) —
 * é o `fetchDataForm` que recebe caminho relativo, e misturar os dois dá 404
 * numa URL que parece certa no código.
 */

/** Lê uma resposta como JSON sem estourar quando não é JSON (proxy no meio,
 * HTML de erro do nginx, 204). */
async function corpoDe(res) {
  return res.json().catch(() => null);
}

/**
 * `GET /whatsapp/status` — a sonda.
 *
 * Responde 200 SEMPRE, ligada ou não: é o endpoint que DIAGNOSTICA o
 * desligado. Um erro aqui, portanto, é problema no servidor da loja (ou na
 * sessão), não na integração — e a tela precisa dizer qual dos dois é.
 */
export async function buscarStatus(authFetch) {
  try {
    const res = await authFetch(`${API_BASE}/whatsapp/status`);
    const corpo = await corpoDe(res);
    if (!res.ok) return { status: null, erro: fraseDeErro(res.status, corpo) };
    return { status: corpo || null, erro: null };
  } catch (erro) {
    console.error("Erro ao consultar o status do WhatsApp", erro?.message);
    return { status: null, erro: "Não foi possível falar com o servidor da loja." };
  }
}

/** `GET /whatsapp/config` — máscaras e interruptores. Nunca o valor. */
export async function buscarConfig(authFetch) {
  try {
    const res = await authFetch(`${API_BASE}/whatsapp/config`);
    const corpo = await corpoDe(res);
    if (!res.ok) return { config: null, erro: fraseDeErro(res.status, corpo) };
    return { config: corpo || null, erro: null };
  } catch (erro) {
    console.error("Erro ao ler a configuração do WhatsApp", erro?.message);
    return { config: null, erro: "Não foi possível falar com o servidor da loja." };
  }
}

/**
 * `GET /whatsapp/templates` — o mapa da loja cruzado com o que a Meta tem.
 *
 * 503 AQUI NÃO É ERRO, é o estado normal de hoje: a rota precisa da integração
 * pronta (com `waba_id`) para perguntar à Meta, e enquanto o número da loja não
 * existir ela vai responder 503 sempre. Por isso o `desligado` sai separado —
 * a tela mostra a explicação em azul, sem tarja vermelha e sem toast.
 */
export async function buscarTemplates(authFetch) {
  try {
    const res = await authFetch(`${API_BASE}/whatsapp/templates`);
    const corpo = await corpoDe(res);
    if (!res.ok) {
      return {
        templates: [],
        erro: fraseDeErro(res.status, corpo),
        desligado: res.status === 503,
      };
    }
    return {
      templates: Array.isArray(corpo?.templates) ? corpo.templates : [],
      erro: null,
      desligado: false,
    };
  } catch (erro) {
    console.error("Erro ao listar os templates do WhatsApp", erro?.message);
    return {
      templates: [],
      erro: "Não foi possível falar com o servidor da loja.",
      desligado: false,
    };
  }
}

/** `GET /whatsapp/mensagens` — o histórico (sem wamid e sem telefone inteiro,
 * por desenho do backend). */
export async function buscarMensagens(authFetch, limite = 50) {
  try {
    const res = await authFetch(
      `${API_BASE}/whatsapp/mensagens?limite=${encodeURIComponent(limite)}`,
    );
    const corpo = await corpoDe(res);
    if (!res.ok) return { mensagens: [], erro: fraseDeErro(res.status, corpo) };
    return {
      mensagens: Array.isArray(corpo?.mensagens) ? corpo.mensagens : [],
      erro: null,
    };
  } catch (erro) {
    console.error("Erro ao ler o histórico do WhatsApp", erro?.message);
    return { mensagens: [], erro: "Não foi possível falar com o servidor da loja." };
  }
}

export function useWhatsAppAcoes({ authFetch, aoFalhar, aoSalvarConfig } = {}) {
  // { [chaveDaAcao]: true } — o que está em voo agora.
  const [emAndamento, setEmAndamento] = useState({});
  const emAndamentoRef = useRef({});

  const marcar = useCallback((chave, ligado) => {
    if (ligado) emAndamentoRef.current[chave] = true;
    else delete emAndamentoRef.current[chave];
    setEmAndamento({ ...emAndamentoRef.current });
  }, []);

  /**
   * O corpo comum das três ações: trava, chamada, frase do servidor, destrava.
   * Devolve `{ ok, corpo }` — `ok:false` já avisou o gestor (toast + tarja).
   */
  const chamar = useCallback(
    async (chave, { caminho, metodo, corpo: dados }) => {
      if (emAndamentoRef.current[chave]) return { ok: false, corpo: null };
      marcar(chave, true);
      try {
        const res = await authFetch(`${API_BASE}${caminho}`, {
          method: metodo,
          // Só `Content-Type`: está em `allowedHeaders`, e nada mais está.
          headers: dados ? { "Content-Type": "application/json" } : undefined,
          body: dados ? JSON.stringify(dados) : undefined,
        });
        const corpo = await corpoDe(res);

        if (!res.ok) {
          const frase = fraseDeErro(res.status, corpo);
          toast.error(frase);
          aoFalhar?.(frase);
          return { ok: false, corpo };
        }
        return { ok: true, corpo };
      } catch (erro) {
        // Só a `message` do erro de rede — o corpo da resposta nunca entra no
        // log do navegador.
        console.error(`Erro na ação "${chave}" do WhatsApp`, erro?.message);
        const frase = "Não foi possível falar com o servidor da loja.";
        toast.error(frase);
        aoFalhar?.(frase);
        return { ok: false, corpo: null };
      } finally {
        marcar(chave, false);
      }
    },
    [authFetch, aoFalhar, marcar],
  );

  /**
   * `PUT /whatsapp/config`. O corpo sai de `corpoDaConfig`, que é quem impede
   * o campo de segredo em branco de virar "apague o token" e a máscara de
   * virar valor — ver o cabeçalho dela.
   *
   * A resposta traz a configuração já relida e mascarada: a tela se atualiza
   * com ela em vez de fazer uma segunda ida ao servidor para saber o que ele
   * acabou de contar.
   */
  const salvarConfig = useCallback(
    async (formulario) => {
      const { ok, corpo } = await chamar("salvar", {
        caminho: "/whatsapp/config",
        metodo: "PUT",
        corpo: corpoDaConfig(formulario),
      });
      if (!ok) return false;
      toast.success(corpo?.message || "Configuração salva.");
      if (corpo?.config) aoSalvarConfig?.(corpo.config);
      return true;
    },
    [chamar, aoSalvarConfig],
  );

  /**
   * `POST /whatsapp/templates`. Um clique cria os SETE templates desta loja na
   * Meta, um a um; a resposta traz uma linha por template, com a frase do erro
   * de cada um que não subiu. 502 (nenhum subiu) já virou tarja no `chamar`, e
   * mesmo assim tem `resultados` — que a tela mostra igual.
   */
  const criarTemplates = useCallback(async () => {
    const { ok, corpo } = await chamar("templates", {
      caminho: "/whatsapp/templates",
      metodo: "POST",
    });
    if (ok) toast.success(corpo?.message || "Templates enviados à Meta.");
    return {
      ok,
      resultados: Array.isArray(corpo?.resultados) ? corpo.resultados : [],
    };
  }, [chamar]);

  /**
   * `POST /whatsapp/teste`. A resposta NÃO traz o número nem o wamid — só os
   * quatro últimos dígitos, e a frase já vem pronta com eles.
   */
  const enviarTeste = useCallback(
    async (para, template) => {
      const { ok, corpo } = await chamar("teste", {
        caminho: "/whatsapp/teste",
        metodo: "POST",
        corpo: template ? { para, template } : { para },
      });
      if (ok) toast.success(corpo?.message || "Mensagem de teste enviada.");
      return ok;
    },
    [chamar],
  );

  return {
    /** `{ [chave]: true }` — o que está em voo agora. */
    emAndamento,
    ocupado: (chave) => Boolean(emAndamento[chave]),
    salvarConfig,
    criarTemplates,
    enviarTeste,
  };
}

export default useWhatsAppAcoes;
