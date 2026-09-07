# Isabel: Será que é Fake?

Jogo multijogador de fatos, blefes e boas risadas para 1–8 pessoas. O placar fica lacrado durante toda a partida e a Isabel só revela respostas, autoria e ranking no grande relatório final.

## O que está pronto

- **Clássico:** 100 fatos em português-BR, seleção sem repetição, dificuldade adaptativa e fontes no relatório.
- **Fatos da Galera:** alimentação em lotes, autoria equilibrada, autor sem voto e reposição de fatos até o limite da partida.
- Sala pública, host com migração automática, reconexão, entrada tardia, cronômetro autoritativo e revanche.
- Pontuação por acerto, rapidez e streak; desempate por tempo médio e encerramento por liderança inalcançável.
- Superadmin protegido para pesquisar, editar, duplicar, arquivar, importar, exportar e auditar o catálogo.
- Interface mobile-first, seis poses otimizadas da Isabel, animações reduzíveis e card social.
- SQLite em WAL, snapshots da sala, backup diário e arquivos de produção para Vercel, Cloudflare, Caddy e systemd.

## Desenvolvimento local

Requer Node.js 24 LTS.

```bash
npm ci
cp client/.env.example client/.env
npm run dev
```

Abra `http://localhost:5173`. A API usa `http://localhost:3000` e cria o banco local automaticamente em `server/data/isabel.sqlite`.

Para validar antes de publicar:

```bash
npm test
npm run build
```

## Estrutura

- `client/`: SPA React/Vite publicada na Vercel.
- `server/`: Express, Socket.IO, SQLite, sala e superadmin na VPS.
- `shared/`: contratos Zod e regras puras compartilhadas.
- `server/data/facts.seed.json`: catálogo inicial versionado.
- `deploy/`: Caddy, systemd, backup, smoke test e arquivos de ambiente.
- `DEPLOY.md`: manual operacional completo em português.

## Segurança e privacidade

O cliente nunca recebe gabarito, autoria, streak ou placar antes de `game:finished`. O `localStorage` contém apenas perfil, token de reconexão, preferências e último relatório. Senhas, certificados e chaves não pertencem ao repositório.

Os 100 fatos iniciais estão ativos e marcados como `pending`, conforme a premissa do MVP; o painel mostra um aviso claro até a auditoria editorial.

## Produção

O frontend está preparado para `seraquefake.pedrooreis.me` e a API para `api.seraquefake.pedrooreis.me`. Siga [DEPLOY.md](./DEPLOY.md) para DNS, TLS, serviço, backups, atualização e rollback.
