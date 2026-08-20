/**
 * O link de WhatsApp da loja — UMA fonte para os dois pontos que o exibem
 * (o botão flutuante `BotaoWhatsApp` e a coluna Ajuda do `Rodape`).
 *
 * `null` quando `NEXT_PUBLIC_WHATSAPP` está vazia ou sem dígito válido:
 * integração desligada por padrão (decisão 5 do plano mestre), e link de
 * contato que abre conversa com ninguém é pior do que não ter link. Os dois
 * consumidores são Server Components — a env é resolvida no build.
 */

const MENSAGEM =
  "Olá! Estou na loja do Café Canastra e preciso de uma ajuda com um pedido.";

export function linkWhatsApp(): string | null {
  // Aceita o número como for colado na env ("+55 (37) 99999-0000") e
  // normaliza para o formato que o wa.me exige: só dígitos, com DDI.
  const numero = (process.env.NEXT_PUBLIC_WHATSAPP || "").replace(/\D/g, "");
  if (!numero) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(MENSAGEM)}`;
}
