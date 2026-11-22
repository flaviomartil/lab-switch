import type { Limits } from './limits'

export function operationsSection(limits: Limits): string {
  return [
    'Codeflow está ativo. Em tarefas com muitas chamadas, use buscas direcionadas,',
    'processe dados localmente e retorne as contagens e evidências necessárias.',
    'Agrupe etapas independentes quando o executor permitir. Se o Code Mode',
    'nativo estiver disponível, reutilize o estado de um bloco em outro.',
    'Para edições em lote, confira o diff real e rode os testes.',
    'As permissões e as instruções do projeto continuam valendo.',
    'Resultados de leitura e busca que o mod reconhece podem ser reduzidos',
    `a ${limits.maxFileLines} linhas, ${limits.maxListItems} entradas ou ${limits.maxToolResultChars} caracteres.`,
    'Quando a saída indicar truncamento, leia um trecho com offset ou refine a busca.',
  ].join('\n')
}
