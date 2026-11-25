; Antes de desinstalar, o próprio launcher desfaz o que registrou no Windows (abrir ao entrar e modo console). Sem isto,
; desinstalar com o modo console ativado deixaria o próximo login numa tela preta, com o Windows procurando um programa que
; não existe mais. Numa atualização nada é desfeito. Veja startup.rs (uninstall_cleanup).
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-cleanup'
  ${EndIf}
!macroend
