; NSIS custom uninstall macro — prompts to delete user data
!macro customUnInstall
  IfFileExists "$APPDATA\KANATA Terminal\*.*" dataExists skipPrompt

  dataExists:
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "ウォッチリストと設定データを削除しますか？$\n$\n$APPDATA\KANATA Terminal$\n$\n[いいえ] を選択するとデータは保持されます。" \
      IDYES doDelete IDNO skipPrompt

    doDelete:
      RMDir /r "$APPDATA\KANATA Terminal"

  skipPrompt:
!macroend
