import type { Metadata } from "next";
import { PaginaTexto, AvisoJuridico } from "@/components/layout/PaginaTexto";

export const metadata: Metadata = {
  title: "Termos de uso — Café Canastra",
  description: "Condições de compra, entrega, trocas e devoluções.",
};

export default function TermosDeUso() {
  return (
    <PaginaTexto titulo="Termos de uso" atualizacao="agosto de 2026">
      <AvisoJuridico />

      <h2>Quem somos</h2>
      <p>
        O Café Canastra é uma marca de café especial da Serra da Canastra, em
        Minas Gerais, em atividade desde 1985. Estes termos regem a compra pelo
        site.
      </p>

      <h2>Pedidos e pagamento</h2>
      {/* A lista de meios é CONDICIONADA à mesma env que liga o cartão no
          checkout (NEXT_PUBLIC_MP_PUBLIC_KEY). Funciona porque os dois são
          resolvidos em tempo de BUILD: a página é estática e a env é assada
          no bundle — o build que mostra o rádio "Cartão" é o mesmo que
          promete cartão aqui, e o build sem a chave promete só Pix. Escolhido
          em vez de "cartão quando disponível" porque termos de uso com
          condicional vago não dizem nada. */}
      <p>
        O pedido é confirmado apenas após a aprovação do pagamento. Trabalhamos
        com {process.env.NEXT_PUBLIC_MP_PUBLIC_KEY?.trim()
          ? "Pix e cartão de crédito"
          : "Pix"}
        . Preços podem mudar sem aviso, mas nunca depois de um pedido
        confirmado.
      </p>

      <h2>Torra e envio</h2>
      <p>
        Torramos sob demanda, em lotes pequenos: torramos na terça e enviamos na
        quarta. Pedidos feitos depois da terça entram na semana seguinte. O prazo
        de entrega mostrado no checkout começa a contar do envio, não do pedido.
      </p>

      <h2>Trocas e devoluções</h2>
      <ul>
        <li>
          Você pode desistir da compra em até 7 dias corridos após o recebimento,
          conforme o Código de Defesa do Consumidor.
        </li>
        <li>
          Pacotes abertos não são aceitos em devolução por arrependimento, por
          se tratar de alimento.
        </li>
        <li>
          Se o produto chegar avariado ou diferente do pedido, trocamos sem custo
          — basta avisar em até 7 dias com uma foto.
        </li>
      </ul>

      {/* Honestidade primeiro: o Clube de assinatura ainda não foi lançado
          (é onda futura do projeto). Prometer regras de cancelamento de um
          serviço que não existe seria o mesmo defeito do botão que não faz
          nada. Quando o Clube abrir, esta seção volta com as regras reais. */}
      <h2>Assinatura</h2>
      <p>
        Hoje toda compra no site é <strong>compra única</strong> — o Clube de
        assinatura ainda não está disponível. Quando abrir, estes termos serão
        atualizados com as regras de cobrança recorrente e cancelamento, e a
        assinatura poderá ser cancelada a qualquer momento, sem multa e sem
        carência.
      </p>

      <h2>Contato</h2>
      <p>
        Dúvidas sobre um pedido: fale com a gente pelo WhatsApp informado no
        rodapé do site.
      </p>
    </PaginaTexto>
  );
}
