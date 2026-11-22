# Comparação A/B do Codeflow

Use o mesmo pacote nos dois lados para manter a coleta equivalente. O modo passivo mede os mesmos eventos e deixa as otimizações inativas.

## Rodadas

Escolha um ID novo e use a mesma versão do Claude Code, modelo, esforço, política, prompt e snapshot de arquivos em cada rodada. Alterne a ordem. Passe o ID somente às sessões do mesmo experimento.

```bash
CLAUDE_CODEFLOW_RUN=busca-01 CLAUDE_CODEFLOW_ENABLED=0 claude --plugin-dir /caminho/codeflow
CLAUDE_CODEFLOW_RUN=busca-01 CLAUDE_CODEFLOW_ENABLED=1 claude --plugin-dir /caminho/codeflow
```

Encerre cada sessão normalmente para registrar as métricas. Abra outra sessão com o mesmo ID e execute `/codeflow report`. Para inclusive medir o ganho do Code Mode nativo, mantenha um experimento separado e altere apenas o estado do executor nativo.

## Leitura

- Compare mediana e faixa do tempo junto da qualidade do resultado. Para publicar números, use pelo menos cinco pares e documente as condições.
- Compare tokens de entrada total, entrada nova, cache lido, cache criado e saída.
- Compare requisições e chamadas observadas. Requisições com várias ferramentas são contadas separadamente.
- Confira o diff do Git e a resposta final. Os relatórios resumem sessões encerradas nas últimas 24 horas com aquele ID.
