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
 * AS TRES DO SUPABASE ENTRARAM NA F2, E `JWT_SECRET`/`JWT_SECRET_REFRESH`
 * SAIRAM. O Express nao emite mais token; ele verifica o do GoTrue.
 *
 *  - SUPABASE_JWT_SECRET: e o `JWT_SECRET` do stack self-hosted, o mesmo com
 *    que o GoTrue assina. Sem ele, `jwt.verify` falha em TODA requisicao
 *    autenticada e a loja responde 403 para clientes legitimos — sintoma sem
 *    relacao obvia com uma variavel esquecida.
 *  - SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY: exclusao de conta passa pela
 *    Admin API do GoTrue (`auth.users` pertence ao GoTrue; nem `service_role`
 *    escreve nele). Sem as duas, a pessoa pede exclusao e nada e apagado.
 *
 * NAO HA CHECAGEM DE `localhost` EM SUPABASE_URL, e isso e deliberado: o
 * Express roda na MESMA VPS do stack, e `http://localhost:8000` (o Kong) e o
 * valor certo em producao. Copiar a trava de CORS_ORIGIN para ca impediria o
 * deploy correto de subir.
 */
const OBRIGATORIAS_EM_PRODUCAO = [
  { nome: "DATABASE_URL", segredo: false },
  { nome: "SUPABASE_URL", segredo: false },
  { nome: "SUPABASE_JWT_SECRET", segredo: true },
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

module.exports = { conferirAmbiente, VALORES_DE_EXEMPLO };
