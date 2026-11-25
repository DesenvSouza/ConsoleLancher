# Início com o Windows e modo console

Em **Configurações › Controle e sistema › Início com o Windows e modo console**.

## 1. Abrir o launcher ao entrar no Windows

Cria um valor `GameLauncher` em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (`"...\launcher.exe" --autostart`). Só vale para o usuário atual, sem administrador. O Windows e a área de trabalho continuam normais por baixo. Se o launcher já estiver aberto, a segunda cópia sai em silêncio. Para entrar sem digitar a senha, configure o login automático do Windows (`netplwiz`).

## 2. Modo console (o launcher no lugar da área de trabalho)

Grava `"...\launcher.exe" --shell` em `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon`, valor `Shell`. O valor por usuário tem prioridade sobre o da máquina (`HKLM`), que não é tocado. Vale a partir da **próxima vez que o usuário entrar** no Windows, por isso o launcher **reinicia o PC** ao ativar (obrigatório): em Configurações, 15 segundos depois da confirmação; no assistente de configuração, só quando ele é concluído. A reinicialização não acontece com um jogo aberto, uma instalação da Epic em andamento ou um desligamento programado, e nunca no modo de desenvolvimento.

**Desinstalar** o launcher desfaz sozinho o modo console e o início automático que apontam para ele (o desinstalador chama `launcher.exe --uninstall-cleanup`). Numa atualização nada é desfeito.

Sem o Explorer não há barra de tarefas, menu Iniciar, relógio, bandeja nem notificações do Windows, e os programas de inicialização (`Run`, pasta Inicializar) não abrem. A Steam, os jogos, o driver de vídeo e o áudio (Dolby Atmos inclusive) funcionam; o launcher abre a Steam sozinho. Configure HDR, resolução, áudio espacial e o painel da placa de vídeo **antes**, com o Windows normal.

### Como o launcher se protege

1. `--shell` é um **vigia**: abre o launcher de verdade (`--supervised`) e o reabre se ele fechar ou travar.
2. 3 quedas rápidas seguidas (cada uma em menos de 20 s), ou falha ao abrir o launcher: o vigia abre o Explorer e sai.
3. **Sair para a área de trabalho** abre o Explorer primeiro, espera a área de trabalho aparecer, minimiza as janelas e fecha o launcher. O vigia entrega a área de trabalho e sai. O modo console continua ativo para a próxima entrada.
4. Se o Explorer for aberto por fora (veja abaixo), o vigia para de reabrir o launcher.
5. Ao ativar, grava `Voltar-ao-Explorer.bat` na pasta de configuração do launcher (`%APPDATA%\<identificador do app>`); a tela mostra o caminho. Sem esse arquivo o modo não ativa.
6. Um shell personalizado que já existia é guardado em `HKCU\Software\GameLauncher\ShellBackup` e devolvido ao desligar.
7. Se o launcher mudar de pasta, o registro é corrigido na abertura seguinte (só quando o caminho antigo não existe mais).

Nada disso funciona com `npm run tauri dev`: o recurso fica indisponível e nada é gravado.

### Se algo der errado

- Tela preta ou launcher travado: **Ctrl+Alt+Del › Gerenciador de Tarefas › Executar nova tarefa › `explorer`**. O vigia percebe e para.
- Para desfazer de vez, com o Explorer aberto: desligue o modo console na tela acima, ou execute `Voltar-ao-Explorer.bat`, ou rode no prompt:

  ```
  reg delete "HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /f
  ```
- Se nem o Gerenciador de Tarefas ajudar: entre com outro usuário do Windows (o valor é por usuário) ou use o modo de recuperação do Windows.

### Primeiro teste

Crie um usuário do Windows só para o console, entre nele, ative o modo console e saia/entre de novo. O seu usuário normal continua com o Explorer.

### Controles que substituem a bandeja do Windows

Sem o Explorer o launcher mostra, ao lado do relógio, volume (ou "Mudo"), rede e bateria do controle, com uma engrenagem que abre o painel **Sistema** (volume, saída de áudio, rede e bateria). O mesmo painel aparece como seção **Sistema** no menu do botão Guia, inclusive por cima de um jogo. Ver `docs/AUDITORIA-2026-11-23.md`.
