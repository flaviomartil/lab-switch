# Lab Switch

Dois terminais Claude Code reais em uma página local. O experimental fica à esquerda. A sessão de controle usa outro perfil e outra cópia do projeto.

## Abrir

Instale as dependências com Node.js 22 ou superior e abra o CLI.

```bash
npm ci
npm start
```

Acesse http://127.0.0.1:4178. O item padrão é o Codeflow 1.1.1 incluído, com o modo ativo à esquerda. O controle usa Claude Code sem carregar o pacote. O campo compartilhado envia quando os dois editores de prompt estão prontos. Cada terminal também aceita teclado e confirmações individualmente.

Os dois processos do Claude iniciam com `--dangerously-skip-permissions`. Use o Lab com projetos e extensões confiáveis. Os processos usam os privilégios da conta local. A interface envia pelo campo compartilhado assim que os dois editores estiverem prontos, independentemente do foco.

## Login

O laboratório reaproveita um token OAuth válido da instalação local do Claude Code ou do Keychain padrão do Mac quando acessível. Também aceita `CLAUDE_CODE_OAUTH_TOKEN` ou `ANTHROPIC_API_KEY` fornecidos ao CLI pelo ambiente. Cada par recebe a mesma autenticação, com configurações, extensões e projetos isolados. A autenticação reaproveitada é repassada aos processos do Claude e o laboratório mantém o token fora dos arquivos e do navegador. Se a credencial reaproveitada expirar, inicie um novo par após renovar o login na instalação principal. O Claude pode pedir a seleção de tema ou a confirmação de confiança para uma pasta nova.

Se o Keychain estiver bloqueado em SSH, use uma credencial oficial fornecida no ambiente do launcher. Veja a [documentação de autenticação do Claude Code](https://code.claude.com/docs/en/authentication).

## Outros itens

A opção `--demo` permite testar a interface com processos de demonstração. A página identifica esse modo. A opção `--model` aplica a mesma escolha aos dois lados.

```bash
npm start -- --demo
npm start -- --model sonnet --port 4180
npm start -- --kind mod --item /caminho/codeflow --project /caminho/projeto
```

`--kind` aceita `mod` (pasta ou ZIP), `skill` (pasta com SKILL.md ou o arquivo), `hook` (JSON de settings com a chave hooks), `mcp` (JSON com mcpServers) e `agent` (JSON de agentes para --agents). `--code-mode` pede o Code Mode nativo em ambos. `--claude-bin` aponta para um executável específico.

## Dados locais

Cada lado recebe um HOME, um CLAUDE_CONFIG_DIR e um diretório de trabalho isolados. Novo par cria novas cópias do projeto e mantém os perfis descartáveis do servidor. Encerrar finaliza os dois processos. Encerre o servidor com Ctrl+C para apagar os perfis do laboratório. O servidor aceita conexões de loopback com a origem local esperada. Use extensões e projetos confiáveis, pois os binários rodam com a conta do usuário e as políticas gerenciadas do Claude continuam valendo.

`npm test` exercita os dois PTYs, o envio em múltiplas linhas, o encerramento e a recusa de origem externa. Os testes usam a demonstração determinística.
