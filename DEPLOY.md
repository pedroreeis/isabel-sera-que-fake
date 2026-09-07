# Guia de produção — Isabel: Será que é Fake?

Este manual publica o frontend na Vercel e mantém a autoridade do jogo em uma VPS Ubuntu/Debian. Nenhuma senha, chave privada ou certificado deve entrar no Git.

## 1. Visão da implantação

- `seraquefake.pedrooreis.me`: SPA React/Vite na Vercel, sem proxy Cloudflare.
- `api-seraquefake.pedrooreis.me`: Cloudflare Tunnel → `cloudflared` na VPS → Node em `127.0.0.1:3000`.
- Estado durável: `/var/lib/isabel/isabel.sqlite`, em WAL.
- Backups: `/var/backups/isabel`, um por dia, retenção de sete dias.
- Processo único: Socket.IO + SQLite. Para múltiplos processos, será obrigatório adicionar Redis antes de escalar horizontalmente.

## 2. Preparar a Vercel

1. Importe o repositório como novo projeto e mantenha a raiz do repositório como **Root Directory**. Não selecione somente `client`, pois o build usa os workspaces e o lockfile da raiz.
2. A configuração de build já está em `vercel.json`: instala somente o workspace web, executa `npm run build` e publica `dist`. O comando raiz direciona a saída do Vite para `dist/index.html`; o SQLite e o servidor não são enviados para a Vercel.
3. Em **Settings → Build and Deployment → Node.js Version**, confirme `24.x`. O `package.json` também exige Node 24, mas vale conferir o log do primeiro build.
4. Cadastre a variável no ambiente **Production**:

   ```text
   VITE_API_URL=https://api-seraquefake.pedrooreis.me
   ```

5. Adicione `seraquefake.pedrooreis.me` em **Settings → Domains** e copie o destino DNS exibido pela Vercel.
6. No Cloudflare, crie o CNAME/A solicitado pela Vercel com nuvem cinza (**DNS only**). Não coloque o proxy laranja na frente desse host.
7. Em **Build and Deployment**, deixe **Build Command** e **Output Directory** sem override. Se o painel exigir valores explícitos, use `npm run build` e `dist`, respectivamente.
8. Faça um novo deploy depois de salvar a variável. Confirme no log a criação de `dist/index.html`; depois valide `/`, `/superadmin` e uma atualização direta nessas rotas.

Os valores presentes em `vercel.json` prevalecem sobre overrides conflitantes do painel. A reescrita para `index.html` é a configuração oficial para deep links de uma SPA Vite. Previews da Vercel não terão acesso ao servidor por padrão: para testar um preview contra a API, inclua **a origem exata** daquele preview em `CLIENT_ORIGINS`, separada por vírgula, e reinicie a API. Não use `*` com cookies administrativos.

### Projeto antigo configurado com raiz `client`

O caminho recomendado continua sendo a raiz do repositório. Ainda assim, `client/vercel.json` espelha a saída `dist`, o fallback da SPA e os cabeçalhos de produção para que um projeto Vercel já criado com **Root Directory = `client`** também publique corretamente. Depois do deploy, `/superadmin` deve responder com a mesma SPA; um `404 NOT_FOUND` nessa rota indica que o deployment promovido ainda não leu uma das duas configurações.

## 3. DNS e TLS da API no Cloudflare

Esta implantação usa **Cloudflare Tunnel**. A conexão nasce da VPS para a Cloudflare, portanto não exige abrir as portas 80, 443 ou 3000 no Oracle Cloud. O certificado HTTPS público e os WebSockets são tratados pela própria Cloudflare.

1. No painel da conta Cloudflare, abra **Networking → Tunnels** e crie um túnel chamado `isabel-api-production`.
2. Escolha Debian, instale o pacote `cloudflared` pela instrução oficial exibida e execute o comando **Install as service**. O token é secreto: não o salve no repositório nem cole em chats.
3. Aguarde o estado **Healthy**. Em **Routes → Add route → Published application**, configure:
   - subdomínio: `api-seraquefake`;
   - domínio: `pedrooreis.me`;
   - serviço: `http://127.0.0.1:3000`.
4. O painel criará automaticamente um CNAME para o túnel. Não crie um registro `A` para essa rota.
5. Em **Network**, mantenha **WebSockets: On**. Em regras de cache, deixe `/api/*` e `/socket.io/*` sem cache.

O host usa apenas um nível abaixo de `pedrooreis.me`, ficando coberto pelo certificado Universal gratuito. Um nome como `api.seraquefake.pedrooreis.me` exigiria cobertura TLS adicional e não deve ser usado nesta instalação.

## 4. Preparar a VPS

Atualize a máquina e instale os utilitários básicos:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git gpg sqlite3 ufw build-essential python3 xz-utils debian-keyring debian-archive-keyring apt-transport-https
```

Instale o `cloudflared` pelo repositório oficial:

```bash
sudo install -d -m 0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared
cloudflared --version
```

Depois, volte ao painel do túnel e execute o comando **Install as service** mostrado ali. Confirme com `systemctl is-enabled cloudflared` e `systemctl is-active cloudflared`; ambos devem responder positivamente.

Instale o Node.js 24 LTS oficial de forma isolada em `/opt/node24`. Isso evita trocar o `/usr/bin/node` de aplicações preexistentes administradas por PM2. A versão abaixo foi conferida no momento deste guia; ao atualizá-la, baixe novamente o `SHASUMS256.txt` correspondente:

```bash
cd /tmp
curl -fsSLO https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz
curl -fsSLO https://nodejs.org/dist/v24.20.0/SHASUMS256.txt
grep ' node-v24.20.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum --check -
sudo tar -xJf node-v24.20.0-linux-x64.tar.xz -C /opt
sudo ln -sfn /opt/node-v24.20.0-linux-x64 /opt/node24
/opt/node24/bin/node --version
/opt/node24/bin/npm --version
```

Interrompa a instalação se a verificação SHA-256 não retornar `OK` ou se `/opt/node24/bin/node --version` não começar por `v24.`. O serviço da Isabel usa explicitamente `/opt/node24/bin/node`; outros projetos continuam na versão que já utilizavam.

Crie o usuário sem privilégios e os diretórios:

```bash
sudo adduser --system --group --home /var/lib/isabel isabel
sudo install -d -m 750 -o isabel -g isabel /var/lib/isabel /var/backups/isabel
sudo install -d -m 755 -o "$USER" -g "$USER" /opt/isabel/releases
sudo install -d -m 750 -o root -g isabel /etc/isabel
```

Firewall mínimo: a porta 3000 nunca deve ficar pública. O túnel precisa apenas de saída para a internet. Antes de ativar o UFW em uma VPS compartilhada, liste os serviços existentes e preserve explicitamente as portas das outras aplicações:

```bash
sudo ss -ltnp
pm2 list
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status numbered
```

Se a máquina já hospeda outros projetos, adicione **antes do `ufw enable`** somente as regras necessárias para eles. Não exponha MariaDB, PM2 ou a porta 3000. Em uma VPS já em produção, mantenha uma segunda sessão SSH aberta ao ativar o firewall para evitar perda de acesso.

## 5. Instalar uma release

Cada atualização ocupa uma pasta própria. Substitua a origem do repositório e o identificador da release:

```bash
release_id="$(date -u +%Y%m%d%H%M%S)"
git clone --depth 1 URL_DO_REPOSITORIO "/opt/isabel/releases/$release_id"
cd "/opt/isabel/releases/$release_id"
PATH=/opt/node24/bin:/usr/bin:/bin /opt/node24/bin/npm ci --omit=dev --workspace @isabel/server --workspace @isabel/shared
PATH=/opt/node24/bin:/usr/bin:/bin /opt/node24/bin/npm install-scripts ls
```

O último comando do npm deve responder `No packages with unreviewed install scripts.`. O projeto autoriza explicitamente somente os scripts nativos versionados de `argon2` e `better-sqlite3`; interrompa o deploy se aparecer qualquer outro pacote pendente.

O SQLite é criado automaticamente na primeira inicialização e recebe os 100 fatos ativos, todos marcados como pendentes de auditoria.

## 6. Configurar a senha e o ambiente

Gere o hash Argon2id sem deixar a senha no histórico. Faça isso **antes** de restringir a nova release a `root:isabel`; depois da restrição, o usuário `ubuntu` não deve conseguir entrar na pasta da aplicação:

```bash
cd "/opt/isabel/releases/$release_id"
read -rsp "Senha do superadmin: " ISABEL_ADMIN_PASSWORD; echo
ADMIN_PLAIN="$ISABEL_ADMIN_PASSWORD" /opt/node24/bin/node -e 'import("argon2").then(async ({default:a}) => console.log(await a.hash(process.env.ADMIN_PLAIN,{type:a.argon2id})))'
unset ISABEL_ADMIN_PASSWORD
```

Copie `deploy/isabel.env.example` para `/etc/isabel/isabel.env`, substitua o hash completo e proteja o arquivo:

```bash
sudo cp "/opt/isabel/releases/$release_id/deploy/isabel.env.example" /etc/isabel/isabel.env
sudoedit /etc/isabel/isabel.env
sudo chown root:isabel /etc/isabel/isabel.env
sudo chmod 640 /etc/isabel/isabel.env
cd /opt/isabel/releases
sudo chown -R root:isabel "/opt/isabel/releases/$release_id"
sudo chmod -R u=rwX,g=rX,o= "/opt/isabel/releases/$release_id"
sudo ln -sfn "/opt/isabel/releases/$release_id" /opt/isabel/current
```

Não use aspas no hash do arquivo `EnvironmentFile`. O caractere `$` é aceito literalmente pelo systemd nesse formato.

Se a senha for esquecida, gere um novo hash com o mesmo procedimento, substitua somente `ADMIN_PASSWORD_HASH` em `/etc/isabel/isabel.env` e reinicie `isabel.service`. Na instalação atual, a senha inicial também pode ser consultada localmente na VPS com `sudo cat /root/isabel-admin-initial-password`; depois de guardá-la em um gerenciador de senhas, remova esse arquivo com `sudo shred -u /root/isabel-admin-initial-password`.

Mantenha `HOST=127.0.0.1`. Depois de iniciar o serviço, `sudo ss -ltnp | grep ':3000'` deve mostrar `127.0.0.1:3000`, nunca `*:3000` ou `0.0.0.0:3000`.

## 7. Ativar túnel, API e backup

```bash
sudo cp /opt/isabel/current/deploy/isabel.service /etc/systemd/system/isabel.service
sudo cp /opt/isabel/current/deploy/isabel-backup.service /etc/systemd/system/isabel-backup.service
sudo cp /opt/isabel/current/deploy/isabel-backup.timer /etc/systemd/system/isabel-backup.timer
sudo systemd-analyze verify /etc/systemd/system/isabel.service /etc/systemd/system/isabel-backup.service /etc/systemd/system/isabel-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared isabel.service isabel-backup.timer
```

Valide a configuração antes de considerar o imóvel entregue:

```bash
systemctl status --no-pager isabel cloudflared isabel-backup.timer
curl --fail http://127.0.0.1:3000/api/healthz
bash deploy/scripts/smoke-test.sh
```

### Se o endereço público não responder

Confirme, nesta ordem:

```bash
sudo systemctl status --no-pager cloudflared isabel
sudo ss -ltnp | grep -E ':3000\b'
curl --fail http://127.0.0.1:3000/api/healthz
sudo ufw status numbered
sudo journalctl -u cloudflared -u isabel -n 100 --no-pager
```

- `127.0.0.1:3000` deve responder antes de investigar a Cloudflare.
- O túnel deve aparecer como **Healthy**, com uma réplica ativa.
- A rota publicada deve apontar `api-seraquefake.pedrooreis.me` para `http://127.0.0.1:3000`.
- O serviço não depende de portas 80/443 liberadas no Oracle Cloud; não altere o NSG apenas para o túnel.

Depois das correções, teste novamente `https://api-seraquefake.pedrooreis.me/api/healthz`.

## 8. Logs e operação

- API: `journalctl -u isabel -f`.
- Túnel: `journalctl -u cloudflared -f`.
- Backup manual: `sudo systemctl start isabel-backup.service`.
- Lista dos timers: `systemctl list-timers isabel-backup.timer`.
- Estado da sala é salvo após voto, alimentação e mudança de fase. Ao reiniciar, prazos vencidos são recalculados.
- Relatórios permanecem até a revanche e são apagados do servidor depois de 30 minutos com a sala vazia; o último relatório pessoal permanece no navegador do jogador.

Teste restauração antes de depender do backup. O procedimento abaixo valida o SHA-256, preserva uma cópia emergencial do banco atual e só então promove o arquivo restaurado:

```bash
backup_file=/var/backups/isabel/ARQUIVO.sqlite3
(cd "$(dirname "$backup_file")" && sha256sum -c "$(basename "$backup_file").sha256")
sudo systemctl stop isabel
sudo cp -a /var/lib/isabel/isabel.sqlite "/var/backups/isabel/pre-restore-$(date -u +%Y-%m-%dT%H-%M-%SZ).sqlite3"
sudo -u isabel sqlite3 "$backup_file" ".backup '/var/lib/isabel/isabel-restaurado.sqlite'"
sudo -u isabel sqlite3 /var/lib/isabel/isabel-restaurado.sqlite 'PRAGMA integrity_check;' | grep -qx ok
sudo rm -f /var/lib/isabel/isabel.sqlite-wal /var/lib/isabel/isabel.sqlite-shm
sudo -u isabel mv /var/lib/isabel/isabel-restaurado.sqlite /var/lib/isabel/isabel.sqlite
sudo systemctl start isabel
curl --fail https://api-seraquefake.pedrooreis.me/api/healthz
```

## 9. Atualização e rollback

Antes de atualizar, rode `npm test` e `npm run build` no CI ou em uma máquina com Node 24. Na VPS, instale uma nova release como na seção 5, faça o link atômico e reinicie:

```bash
sudo systemctl restart isabel
bash /opt/isabel/current/deploy/scripts/smoke-test.sh
```

Se o smoke test falhar, aponte `/opt/isabel/current` para a release anterior e reinicie. Não apague releases antigas até confirmar a nova versão e um backup válido:

```bash
sudo ln -sfn /opt/isabel/releases/ID_ANTERIOR /opt/isabel/current
sudo systemctl restart isabel
```

Mudanças futuras de schema devem vir acompanhadas de migração reversível ou backup obrigatório. O catálogo também pode ser exportado em JSON pelo superadmin antes de cada atualização.

O frontend tem rollback independente: em **Vercel → Deployments**, abra o último deployment conhecido como estável e use **Promote to Production**. Depois valide `/` e `/superadmin`; reverter apenas a SPA não altera o SQLite.

## 10. Checklist de aceite em produção

- HTTPS da SPA e `/superadmin` sem conteúdo misto.
- `GET /api/healthz` retorna `ok: true` e `seededFacts: 100`.
- WSS conecta através da Cloudflare e reconecta após troca de rede.
- Duas abas completam os modos Clássico e Fatos da Galera sem revelar placar durante as rodadas.
- O 9º participante é recusado e quem entra no meio aguarda a revanche.
- Host migra após 30 segundos; assento é reservado por 60 segundos.
- Superadmin exige senha, cookie seguro e CSRF; importação simulada mostra erros por linha.
- Backup diário é criado, validado pelo SHA-256 e removido após sete dias.
- Restauração e rollback foram praticados pelo menos uma vez.

## 11. Credenciais que ainda serão necessárias

Para efetivar a publicação, o operador precisa autorizar acesso ao projeto Vercel, à zona DNS/SSL na Cloudflare e ao SSH da VPS. Não cole essas credenciais em arquivos do projeto; prefira sessões autenticadas, chaves SSH e variáveis secretas das plataformas.

## 12. Referências oficiais conferidas

- [Vite como SPA na Vercel](https://vercel.com/docs/frameworks/frontend/vite) e [configuração de build](https://vercel.com/docs/builds/configure-a-build).
- [Node.js 24 na Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
- [Criar e executar um Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/) e [rotas publicadas](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/).
- [Cobertura e limitações do Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).
- [Status do certificado de borda](https://developers.cloudflare.com/ssl/reference/certificate-statuses/).
- [WebSockets na Cloudflare](https://developers.cloudflare.com/network/websockets/) e [Cache Rules com bypass](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/).
