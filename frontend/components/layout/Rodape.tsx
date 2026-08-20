import Image from "next/image";
import Link from "next/link";
import { linkWhatsApp } from "@/lib/whatsapp";
import { BotaoReverCookies } from "./BotaoReverCookies";

/**
 * estetica.md §5.10 — fundo fuligem, quatro colunas, e encerra com o lockup
 * COMPLETO do logo, grande (max 480px), com o "Desde 1985" visivel. E o unico
 * lugar da navegacao onde a marca aparece em tamanho generoso.
 */

const COLUNAS = [
  {
    titulo: "Cafés",
    itens: [
      { href: "/cafes", rotulo: "Todos os cafés" },
      { href: "/cafes?linha=classico", rotulo: "Clássico" },
      { href: "/cafes?linha=suave", rotulo: "Suave" },
      // A linha "aromatizado" nao existe mais no contrato: o catalogo real
      // tem "canela", que e a linha aromatizada de fato vendida.
      { href: "/cafes?linha=canela", rotulo: "Canela" },
    ],
  },
  {
    titulo: "Assinatura",
    itens: [
      { href: "/clube", rotulo: "Clube da Canastra" },
      { href: "/clube", rotulo: "Como funciona" },
    ],
  },
  {
    titulo: "A Canastra",
    itens: [
      { href: "/a-serra", rotulo: "A serra" },
      { href: "/cafes", rotulo: "As linhas" },
      { href: "/a-serra#torra", rotulo: "A torra" },
    ],
  },
  {
    titulo: "Ajuda",
    itens: [
      { href: "/termos-de-uso", rotulo: "Termos de uso" },
      { href: "/politica-de-privacidade", rotulo: "Política de privacidade" },
    ],
  },
];

type ItemDeColuna = { href: string; rotulo: string; externo?: boolean };

/**
 * As colunas com o canal de contato anexado quando ele existe.
 *
 * O link vem de `lib/whatsapp.ts` — a MESMA fonte do botão flutuante
 * (BotaoWhatsApp), para número e mensagem nunca divergirem entre os dois.
 * Sem a env, a coluna fica como está: link de contato que abre conversa com
 * ninguém é pior do que não ter link.
 */
function colunas(): { titulo: string; itens: ItemDeColuna[] }[] {
  const whatsapp = linkWhatsApp();
  if (!whatsapp) return COLUNAS;

  return COLUNAS.map((coluna) =>
    coluna.titulo === "Ajuda"
      ? {
          ...coluna,
          itens: [
            ...coluna.itens,
            { href: whatsapp, rotulo: "WhatsApp", externo: true },
          ],
        }
      : coluna,
  );
}

export function Rodape() {
  return (
    <footer className="mt-auto bg-fuligem text-cal">
      <div className="mx-auto max-w-[1440px] px-4 py-14 md:px-10 md:py-24">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4">
          {colunas().map((coluna) => (
            <div key={coluna.titulo}>
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-juta">
                {coluna.titulo}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {coluna.itens.map((item) => (
                  <li key={item.href}>
                    {item.externo ? (
                      // <a> e nao <Link>: destino fora da loja (wa.me).
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[15px] text-cal/80 transition-colors hover:text-cal focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
                      >
                        {item.rotulo}
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        className="text-[15px] text-cal/80 transition-colors hover:text-cal focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
                      >
                        {item.rotulo}
                      </Link>
                    )}
                  </li>
                ))}
                {coluna.titulo === "Ajuda" ? (
                  // Botão, não link: revoga o consentimento de cookies na hora
                  // (LGPD — sair tem de ser tão fácil quanto entrar). Estilo dos
                  // vizinhos, passado por prop porque o padrão do componente é o
                  // da página clara.
                  <li>
                    <BotaoReverCookies className="text-[15px] text-cal/80 transition-colors hover:text-cal focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho" />
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center border-t border-fuligem-80 pt-12 md:mt-16 md:pt-14">
          {/* O <div> com largura propria e o que impede o estouro: sem ele o
              flex se dimensiona pela largura intrinseca do PNG (3508px) e o
              documento inteiro ganha rolagem horizontal em mobile.
              invert() porque o ativo e preto sobre transparente e o fundo aqui
              e fuligem. Some quando o SVG com currentColor existir (§1). */}
          <div className="w-full max-w-[320px] md:max-w-[480px]">
            <Image
              src="/logo-canastra.png"
              alt="Café Canastra, desde 1985"
              width={3508}
              height={2481}
              sizes="(min-width: 768px) 480px, 320px"
              className="h-auto w-full invert"
            />
          </div>
          <p className="mt-8 text-center font-dado text-[11px] tracking-[0.06em] text-fuligem-20">
            Serra da Canastra · Minas Gerais
          </p>
        </div>
      </div>
    </footer>
  );
}
