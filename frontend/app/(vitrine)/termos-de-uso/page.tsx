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
      <p>
        O pedido é confirmado apenas após a aprovação do pagamento. Trabalhamos
        com Pix e cartão de crédito. Preços podem mudar sem aviso, mas nunca
        depois de um pedido confirmado.
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

      <h2>Assinatura</h2>
      <p>
        A assinatura pode ser cancelada a qualquer momento, sem multa e sem
        carência. O cancelamento vale para os envios seguintes; envios já
        torrados e despachados não são estornados.
      </p>

      <h2>Contato</h2>
      <p>
        Dúvidas sobre um pedido: fale com a gente pelo WhatsApp informado no
        rodapé do site.
      </p>
    </PaginaTexto>
  );
}
