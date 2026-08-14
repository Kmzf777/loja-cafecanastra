/**
 * Import de folha de estilo global como efeito colateral (`import "./globals.css"`).
 *
 * O Next declara apenas `*.module.css` em next/types/global.d.ts; CSS global nao
 * tem declaracao nenhuma. Ate o TypeScript 5 isso passava calado, mas o TS 6
 * levanta TS2882 ("Cannot find module or type declarations for side-effect
 * import") — foi o que apareceu ao converter app/layout.jsx em app/layout.tsx.
 * O bundler resolve o arquivo normalmente; falta so o tipo.
 */
declare module "*.css";
declare module "*.scss";
declare module "*.sass";
