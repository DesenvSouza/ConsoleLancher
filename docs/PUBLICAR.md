# Publicar versões e atualizações automáticas

## Como funciona

1. Você envia uma **tag** de versão (`v0.2.0`) ao GitHub.
2. O GitHub Actions ([release.yml](../.github/workflows/release.yml)) compila, **assina** o instalador e cria um **rascunho**
   de publicação com o instalador, a assinatura e o `latest.json`.
3. Você confere o rascunho e clica em **Publish release**. Só então os jogadores recebem.
4. O launcher instalado procura ao abrir e a cada 6 horas. Havendo versão nova, mostra um aviso no Início (uma vez por versão)
   e a opção fica em **Configurações › Sistema e energia › Atualizações**. Nada é instalado sem o jogador confirmar, nem com um
   jogo aberto, uma instalação da Epic em andamento ou um desligamento programado.

O pacote só é instalado se a assinatura conferir com a **chave pública** que está dentro do launcher, e se a versão assinada
for a mesma que o `latest.json` anuncia.

## Preparação (uma vez só)

### 1. Criar a chave de assinatura

No seu PC, na pasta do projeto. Ele pede uma senha: use uma e guarde. (`npx.cmd`, e não `npx`, porque o PowerShell costuma
bloquear a versão em script.)

```powershell
npx.cmd tauri signer generate -w "$HOME\.tauri\console-launcher.key"
```

Saem dois arquivos em `%USERPROFILE%\.tauri`:

| Arquivo | O que é |
|---|---|
| `console-launcher.key` | chave **privada**. Nunca vai para o repositório, para conversas nem para outras pessoas |
| `console-launcher.key.pub` | chave pública, que vai dentro do launcher |

**Faça uma cópia da chave privada e da senha em lugar seguro.** Se elas se perderem, os launchers já instalados não aceitam mais
atualizações: cada jogador teria de instalar tudo de novo à mão.

### 2. Colocar a chave pública no projeto

Copie a chave pública:

```powershell
Get-Content "$HOME\.tauri\console-launcher.key.pub" -Raw | Set-Clipboard
```

Cole em `src-tauri/tauri.conf.json`, em `plugins.updater.pubkey` (uma linha só, entre as aspas) e faça o commit.

Enquanto esse campo estiver vazio, o launcher não procura atualizações e a publicação é recusada.

### 3. Guardar a chave privada nos segredos do GitHub

No repositório: **Settings › Secrets and variables › Actions › New repository secret**.

| Nome | Valor |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | todo o conteúdo de `console-launcher.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | a senha escolhida |

Para copiar o conteúdo da chave privada sem abrir o arquivo (depois de colar, copie qualquer outra coisa para limpar a área de
transferência):

```powershell
Get-Content "$HOME\.tauri\console-launcher.key" -Raw | Set-Clipboard
```

## Publicar uma versão

1. Escreva o que mudou em [NOVIDADES.md](NOVIDADES.md): é o texto que o jogador lê no aviso (curto, até umas 8 linhas, sem
   formatação).
2. Mude a versão (ela precisa ser **maior** que a anterior):

```powershell
npm.cmd run version:set -- 0.2.0
```

3. Faça o commit de tudo, crie a tag e envie:

```powershell
git commit -am "v0.2.0"
```

```powershell
git tag v0.2.0
```

```powershell
git push origin main v0.2.0
```

4. Acompanhe em **Actions** (leva alguns minutos).
5. Em **Releases**, abra o rascunho e confira se há o `…-setup.exe`, o `.sig` e o `latest.json`. Clique em **Publish release**,
   sem marcar como *pre-release* (o launcher só enxerga a publicação marcada como a mais recente).

## Primeira distribuição

- Quem vai usar baixa o `…-setup.exe` da publicação mais recente. A versão instalada precisa **já conter a chave pública**.
- A instalação é só para o usuário atual e não pede senha de administrador.
- O instalador não tem certificado de assinatura de código do Windows (é outra coisa, paga): no primeiro download o
  SmartScreen pode avisar "editor desconhecido".

## Testar uma atualização de ponta a ponta

Publique a `v0.1.0`, instale-a, depois publique a `v0.1.1`. No launcher instalado: **Configurações › Sistema e energia ›
Versão do launcher** → **Atualizar agora**. Ele fecha, mostra a barra do instalador, reabre e avisa a versão nova. Faça o teste
também no modo console, se for usá-lo.

No `tauri dev` o launcher procura versões, mas não instala.

## Antivírus e assinatura do programa

O pedido ao SignPath Foundation está descrito em [SIGNPATH.md](SIGNPATH.md).

A assinatura das **atualizações** (a chave acima) só garante que o pacote é seu. O Windows não a enxerga: para ele o
programa não tem assinatura de código (Authenticode). Em 2026-11-25 o Microsoft Defender removeu o launcher recém-atualizado
como `Trojan:Win32/Bearfoos.A!ml` (classificação por aprendizado de máquina, provável falso positivo).

Caminhos, do que resolve mais ao que resolve só um PC:

| Caminho | O que exige |
|---|---|
| Certificado de assinatura de código | identidade verificada em seu nome. O [Artifact Signing da Microsoft](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) aceita pessoas físicas só nos EUA e no Canadá. Do Brasil: [Certum Open Source](https://shop.certum.eu/open-source-code-signing-on-simplysign.html) (pago), [SignPath Foundation](https://signpath.org/terms) (gratuito, com aprovação; o editor exibido é a fundação) ou um certificado OV comum. As opções para código aberto exigem uma licença no repositório |
| Informar o falso positivo à Microsoft | enviar o arquivo em [microsoft.com/wdsi/filesubmission](https://www.microsoft.com/en-us/wdsi/filesubmission), a cada versão que for acusada |
| Exceção no Defender do próprio PC | administrador; o que estiver na pasta deixa de ser verificado |

Um certificado **autoassinado não resolve**: o Windows não confia nele.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| "Nenhuma versão publicada foi encontrada." | a publicação ainda é rascunho ou está como *pre-release* |
| "A assinatura do pacote não confere." | a chave privada dos segredos não é o par da chave pública do launcher instalado |
| A publicação falha logo no começo | a tag não bate com a versão, ou falta a chave pública ou o segredo |
| Uma versão saiu com defeito | o launcher não volta para versões antigas: publique uma **mais nova** com a correção |

## Modo console

Antes de instalar, o launcher abre a área de trabalho do Windows (senão a tela ficaria preta durante a instalação). Depois o
instalador reabre o launcher; o modo console volta a valer no próximo login.
