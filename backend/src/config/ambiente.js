/**
 * Conferencia de ambiente na subida do processo.
 *
 * O `.env.example` e versionado e traz valores de desenvolvimento escritos por
 * extenso — e o jeito certo de documentar as variaveis, mas cria um risco
 * concreto: quem faz deploy copia o exemplo, esquece de trocar, e sobe a loja
 * com credencial publicamente conhecida.
 *
 * Em producao, entao, o processo RECUSA subir se algum segredo obrigatorio
 * estiver ausente, curto demais ou igual ao valor de exemplo. Falhar no
 * `npm start` e barulhento e barato; descobrir depois, não.
 *
 * Em desenvolvimento nada disso trava — so avisa.
 */

/**
 * Valores publicados no .env.example. Nunca podem valer em producao.
 *
 * Os dois segredos de JWT proprios da loja sairam desta lista junto com as
 * variaveis: quem assina token agora e o GoTrue, e o segredo dele
 * (SUPABASE_JWT_SECRET) e gerado por quem sobe a instancia — nao existe valor
 * de exemplo dele para reconhecer aqui.
 */
const VALORES_DE_EXEMPLO = new Set([
  "teste@teste.com",
  "123456",
]);

const TAMANHO_MINIMO_SEGREDO = 32;
const TAMANHO_MINIMO_SENHA_ADMIN = 12;

/**
 * NODE_ENV precisa ser um dos tres valores conhecidos.
 *
 * Quatro defesas do backend dependem da comparacao com a string exata
 * "production": CSP do helmet, isolamento de origem no CORS, `secure` no cookie
 * de sessao e esta propria conferencia. Escrever "prod" ou "producao" no painel
 * do provedor — ou deixar a variavel vazia — desliga as quatro de uma vez, sem
 * nenhuma reclamacao. Recusar valor desconhecido transforma um erro de
 * digitacao silencioso numa falha imediata na subida.
 */
const AMBIENTES_VALIDOS = new Set(["development", "test", "production"]);

/**
 * Obrigatorias em producao: sem elas a loja nao funciona ou fica insegura.
 *
 * AS DUAS DO SUPABASE ENTRARAM NA F2, E `JWT_SECRET`/`JWT_SECRET_REFRESH`
 * SAIRAM. O Express nao emite mais token; ele verifica o do GoTrue.
 *
 *  - SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY: exclusao de conta passa pela
 *    Admin API do GoTrue (`auth.users` pertence ao GoTrue; nem `service_role`
 *    escreve nele). Sem as duas, a pessoa pede exclusao e nada e apagado.
 *    SUPABASE_URL ficou ainda mais central depois que `isAuthenticated` passou
 *    a saber verificar token assinado por chave assimetrica: e dela que sai o
 *    `/auth/v1/.well-known/jwks.json`.
 *
 * `SUPABASE_JWT_SECRET` SAIU DAQUI, e a ausencia dela NAO virou "tanto faz" —
 * virou a conferencia de `conferirCaminhosDeVerificacao`, mais abaixo. O motivo
 * esta explicado la.
 *
 * NAO HA CHECAGEM DE `localhost` EM SUPABASE_URL, e isso e deliberado: o
 * Express roda na MESMA VPS do stack, e `http://localhost:8000` (o Kong) e o
 * valor certo em producao. Copiar a trava de CORS_ORIGIN para ca impediria o
 * deploy correto de subir.
 */
const OBRIGATORIAS_EM_PRODUCAO = [
  { nome: "DATABASE_URL", segredo: false },
  { nome: "SUPABASE_URL", segredo: false },
  { nome: "SUPABASE_SERVICE_ROLE_KEY", segredo: true },
  { nome: "CORS_ORIGIN", segredo: false },
  // Sem o segredo do webhook o backend recusa toda notificacao do Mercado Pago
  // (ver validarAssinaturaWebhook), e nenhum pedido sai de "pendente".
  { nome: "MP_WEBHOOK_SECRET", segredo: true },
  { nome: "MP_ACCESS_TOKEN", segredo: true },
];

/**
 * O papel declarado dentro de uma chave de API do Supabase.
 *
 * Nao verifica assinatura — nao e conferencia de seguranca, e conferencia de
 * digitacao: a chave e um JWT e o payload dela diz `{"role": "..."}`. Devolve
 * `null` quando o formato nao e reconhecido, e ai nada e reclamado: uma
 * instancia que emita chave em outro formato nao pode ser motivo para o
 * servidor recusar subir.
 */
function papelDaChave(chave, esperado) {
  const partes = String(chave).split(".");
  if (partes.length !== 3) return true;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return payload.role === undefined || payload.role === esperado;
  } catch {
    return true;
  }
}

function conferirAmbiente({ ehProducao = process.env.NODE_ENV === "production" } = {}) {
  const erros = [];
  const avisos = [];

  const ambiente = process.env.NODE_ENV || "";
  if (ambiente && !AMBIENTES_VALIDOS.has(ambiente)) {
    console.error(
      `\n❌ NODE_ENV="${ambiente}" não é reconhecido. Use development, test ou production.\n` +
        "   Toda a postura de segurança do backend depende deste valor.\n",
    );
    throw new Error(`NODE_ENV inválido: ${ambiente}`);
  }

  /**
   * A conta semeada nunca pode nascer com a credencial de exemplo.
   * O .env.example é versionado e o cabeçalho manda copiá-lo para .env — sem
   * esta trava, o deploy "conforme a documentação" criaria um administrador de
   * e-mail previsível e senha publicada neste repositório.
   */
  const senhaAdmin = process.env.SEED_ADMIN_PASSWORD;
  const emailAdmin = process.env.SEED_ADMIN_EMAIL;
  if (ehProducao && (senhaAdmin || emailAdmin)) {
    if (VALORES_DE_EXEMPLO.has(emailAdmin) || VALORES_DE_EXEMPLO.has(senhaAdmin)) {
      erros.push(
        "SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD estão com os valores de exemplo.",
      );
    } else if (senhaAdmin && senhaAdmin.length < TAMANHO_MINIMO_SENHA_ADMIN) {
      erros.push(
        `SEED_ADMIN_PASSWORD tem menos de ${TAMANHO_MINIMO_SENHA_ADMIN} caracteres. Gere com: openssl rand -base64 24`,
      );
    }
  }

  for (const { nome, segredo } of OBRIGATORIAS_EM_PRODUCAO) {
    const valor = process.env[nome];

    if (!valor) {
      (ehProducao ? erros : avisos).push(`${nome} não está definida.`);
      continue;
    }
    if (VALORES_DE_EXEMPLO.has(valor)) {
      (ehProducao ? erros : avisos).push(
        `${nome} ainda está com o valor de exemplo do .env.example. Gere um novo com: openssl rand -hex 32`,
      );
      continue;
    }
    if (segredo && valor.length < TAMANHO_MINIMO_SEGREDO) {
      (ehProducao ? erros : avisos).push(
        `${nome} tem menos de ${TAMANHO_MINIMO_SEGREDO} caracteres — curto demais para assinar token.`,
      );
    }
  }

  /**
   * `SUPABASE_JWT_SECRET` e OPCIONAL — mas, quando existe, nunca fraca.
   *
   * Ela saiu das obrigatorias porque um projeto hospedado ja migrado para
   * chaves de assinatura NAO TEM uso para ela: o GoTrue assina em ES256 e quem
   * verifica busca a chave publica no JWKS. Exigi-la ali forcaria o operador a
   * inventar um valor so para o processo subir — um segredo de mentira, que e
   * pior do que nenhum. A ausencia dela, porem, nao passa em branco: quem
   * decide se sobra algum caminho de verificacao e
   * `conferirCaminhosDeVerificacao`.
   */
  const segredoDoGoTrue = process.env.SUPABASE_JWT_SECRET;
  if (segredoDoGoTrue && segredoDoGoTrue.length < TAMANHO_MINIMO_SEGREDO) {
    (ehProducao ? erros : avisos).push(
      `SUPABASE_JWT_SECRET tem menos de ${TAMANHO_MINIMO_SEGREDO} caracteres — curto demais para assinar token. ` +
        "Se a instância assina em ES256/RS256, deixe a variável VAZIA em vez de preenchê-la com um valor qualquer.",
    );
  }

  /**
   * A `service_role key` e a `anon key` sao JWT parecidos, emitidos pelo mesmo
   * lugar e faceis de trocar um pelo outro no painel do provedor. Trocados, o
   * Express perde poder em silencio: a exclusao de conta passa a responder 401
   * do GoTrue, e ninguem liga isso a variavel errada. O papel viaja DENTRO da
   * chave, entao da para conferir sem pedir nada a instancia.
   */
  const chaveDeServico = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (chaveDeServico && !papelDaChave(chaveDeServico, "service_role")) {
    (ehProducao ? erros : avisos).push(
      "SUPABASE_SERVICE_ROLE_KEY não é uma chave de service_role (confira se não colou a anon key).",
    );
  }

  if (ehProducao && /localhost|127\.0\.0\.1/.test(process.env.CORS_ORIGIN || "")) {
    erros.push("CORS_ORIGIN aponta para localhost em produção.");
  }

  if (avisos.length) {
    console.warn(
      "\n⚠️  Configuração incompleta (tolerada fora de produção):\n" +
        avisos.map((a) => `   · ${a}`).join("\n") +
        "\n",
    );
  }

  if (erros.length) {
    console.error(
      "\n❌ Configuração inválida para produção. O servidor não vai subir:\n" +
        erros.map((e) => `   · ${e}`).join("\n") +
        "\n   Corrija as variáveis de ambiente e tente de novo.\n",
    );
    throw new Error("Configuração de ambiente inválida para produção.");
  }

  return { erros, avisos };
}

/**
 * SOBRA ALGUM CAMINHO DE VERIFICACAO DE TOKEN? A pergunta que substitui
 * "SUPABASE_JWT_SECRET esta definida?".
 *
 * O QUE "CONFIGURADO" PASSOU A SIGNIFICAR. `isAuthenticated` verifica por dois
 * caminhos, e a loja precisa de PELO MENOS UM funcionando:
 *
 *   HS256, com `SUPABASE_JWT_SECRET` -> o stack self-hosted, alvo de producao;
 *   ES256/RS256, pelo JWKS de `SUPABASE_URL` -> o projeto hospedado.
 *
 * Um teste puramente sintatico ("uma das duas variaveis esta preenchida?") NAO
 * serve, e vale dizer por que: `SUPABASE_URL` e obrigatoria de qualquer jeito
 * (a exclusao de conta depende dela), entao ela estaria SEMPRE preenchida e a
 * condicao passaria sempre — inclusive num stack self-hosted que esqueceu o
 * segredo e cujo JWKS responde `{"keys":[]}`. Seria exatamente o "aceitar em
 * silencio uma configuracao onde nada verifica nada". Nesse deploy toda
 * requisicao autenticada responderia 503, e o `npm start` teria dito que estava
 * tudo bem.
 *
 * ENTAO A CONFERENCIA PERGUNTA A INSTANCIA. So quando `SUPABASE_JWT_SECRET`
 * esta ausente — nesse caso o JWKS e o unico caminho, e a unica forma de saber
 * se ele existe e buscar. Conjunto VAZIO (ou 404) e resposta definitiva: nao ha
 * chave assimetrica publicada, nao ha segredo, nada jamais sera verificado; em
 * producao isso derruba a subida, que e barulhento e barato. Conjunto
 * INALCANCAVEL e outra coisa: pode ser so ordem de subida (o Express e o Kong
 * sobem juntos na mesma VPS), entao vira aviso alto e o processo segue —
 * enquanto durar, as requisicoes autenticadas respondem 503, que e a resposta
 * honesta.
 *
 * COM O SEGREDO DEFINIDO NADA DISSO ACONTECE, e isso importa: a subida do
 * Express nao ganha dependencia de rede no caminho que ja funcionava. A busca
 * ainda e feita (aquece o cache, e a primeira requisicao autenticada nao paga a
 * ida), mas falhar nela nao e nem erro nem aviso — e so a informacao de que
 * aquele deploy nao usa o caminho assimetrico.
 */
async function conferirCaminhosDeVerificacao({
  ehProducao = process.env.NODE_ENV === "production",
  chaves = require("../utils/chavesDoGoTrue"),
} = {}) {
  const temSegredo = Boolean(process.env.SUPABASE_JWT_SECRET);

  let quantasChaves = null;
  let falha = null;
  try {
    quantasChaves = await chaves.aquecerCache();
  } catch (erro) {
    falha = erro;
  }

  if (temSegredo) {
    const extra =
      quantasChaves > 0
        ? ` e ${quantasChaves} chave(s) no JWKS da instância`
        : falha
          ? ` (o JWKS não respondeu: ${falha.message} — sem efeito, o segredo dá conta)`
          : " (a instância não publica chave assimétrica — normal em stack self-hosted)";
    console.log(`Verificação de token: HS256 por SUPABASE_JWT_SECRET${extra}.`);
    return { ok: true, temSegredo, quantasChaves };
  }

  if (quantasChaves > 0) {
    console.log(
      `Verificação de token: ${quantasChaves} chave(s) assimétrica(s) do JWKS. ` +
        "SUPABASE_JWT_SECRET não está definida, e para esta instância não precisa estar.",
    );
    return { ok: true, temSegredo, quantasChaves };
  }

  if (falha) {
    console.warn(
      "\n⚠️  SUPABASE_JWT_SECRET não está definida e o JWKS da instância não respondeu:\n" +
        `   · ${falha.message}\n` +
        "   Enquanto isso durar, TODA rota autenticada responde 503.\n" +
        "   Se o stack ainda está subindo, isso se resolve sozinho. Se não,\n" +
        "   confira SUPABASE_URL — ou defina SUPABASE_JWT_SECRET.\n",
    );
    return { ok: false, temSegredo, quantasChaves: null, falha };
  }

  const mensagem =
    "Nenhum caminho de verificação de token está configurado: SUPABASE_JWT_SECRET " +
    "não está definida e o JWKS da instância não publica nenhuma chave assimétrica " +
    "utilizável. Toda requisição autenticada seria recusada.";

  if (!ehProducao) {
    console.warn(`\n⚠️  ${mensagem}\n`);
    return { ok: false, temSegredo, quantasChaves: 0 };
  }

  console.error(
    `\n❌ ${mensagem}\n` +
      "   Escolha um dos dois:\n" +
      "   · stack self-hosted → defina SUPABASE_JWT_SECRET com o JWT_SECRET da instância;\n" +
      "   · projeto com chaves de assinatura → confira SUPABASE_URL e se as chaves\n" +
      "     assimétricas estão publicadas (Settings → API Keys → JWT Keys).\n",
  );
  throw new Error("Nenhum caminho de verificação de token configurado.");
}

module.exports = {
  conferirAmbiente,
  conferirCaminhosDeVerificacao,
  VALORES_DE_EXEMPLO,
};
