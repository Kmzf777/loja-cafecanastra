"use client";

import { ErroDePagina } from "../erro-de-pagina";

/**
 * Fronteira de erro do caminho de compra.
 *
 * SEM ESTE ARQUIVO, uma falha na sacola ou no checkout escapa do grupo e cai na
 * tela de erro padrão do Next — sem cabeçalho, sem rodapé, sem sacola e sem
 * saída, no exato momento em que a pessoa está pagando. Enquanto o grupo era
 * `(vitrine)`, ele herdava a fronteira de lá; ao sair para `(transacional)`,
 * precisou da própria. Conteúdo em `app/erro-de-pagina.tsx`.
 */
export default ErroDePagina;
