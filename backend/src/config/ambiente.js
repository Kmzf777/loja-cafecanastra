/**
 * Conferencia de ambiente na subida do processo.
 *
 * O `.env.example` e versionado e traz segredos de desenvolvimento escritos por
 * extenso — e o jeito certo de documentar as variaveis, mas cria um risco
 * concreto: quem faz deploy copia o exemplo, esquece de trocar, e sobe a loja
 * com JWT_SECRET publicamente conhecido. Quem le este repositorio consegue
 * assinar um token de admin.
 *
 * Em producao, entao, o processo RECUSA subir se algum segredo obrigatorio
 * estiver ausente, curto demais ou igual ao valor de exemplo. Falhar no
 * `npm start` e barulhento e barato; descobrir depois, não.
 *
 * Em desenvolvimento nada disso trava — so avisa.
 */

/** Valores publicados no .env.example. Nunca podem valer em producao. */
const VALORES_DE_EXEMPLO = new Set([
  "canastra-dev-access-secret-nao-usar-em-producao",
  "canastra-dev-refresh-secret-nao-usar-em-producao",
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

/** Obrigatorias em producao: sem elas a loja nao funciona ou fica insegura. */
const OBRIGATORIAS_EM_PRODUCAO = [
  { nome: "DATABASE_URL", segredo: false },
  { nome: "JWT_SECRET", segredo: true },
  { nome: "JWT_SECRET_REFRESH", segredo: true },
  { nome: "CORS_ORIGIN", segredo: false },
  // Sem o segredo do webhook o backend recusa toda notificacao do Mercado Pago
  // (ver validarAssinaturaWebhook), e nenhum pedido sai de "pendente".
  { nome: "MP_WEBHOOK_SECRET", segredo: true },
  { nome: "MP_ACCESS_TOKEN", segredo: true },
];

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

  // Os dois segredos de JWT precisam ser DIFERENTES: se forem iguais, um
  // refresh token passa como access token e vice-versa, e a expiracao curta do
  // access token deixa de valer para qualquer coisa.
  if (
    process.env.JWT_SECRET &&
    process.env.JWT_SECRET === process.env.JWT_SECRET_REFRESH
  ) {
    (ehProducao ? erros : avisos).push(
      "JWT_SECRET e JWT_SECRET_REFRESH são iguais: um refresh token passaria como token de acesso.",
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
