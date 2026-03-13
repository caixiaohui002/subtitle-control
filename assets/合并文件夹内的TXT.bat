@echo off
set "OutputFile=全部剧本.txt"

if exist "%OutputFile%" del "%OutputFile%"

:: 1. 执行合并逻辑（保持你测试成功的 Byte 模式）
powershell -Command "$files = Get-ChildItem -Filter '*.txt' | Where-Object { $_.Name -ne '%OutputFile%' }; $sorted = $files | Sort-Object { [regex]::Replace($_.Name, '\d+', { $args[0].Value.PadLeft(20, '0') }) }; foreach ($file in $sorted) { Get-Content -Path $file.FullName -Encoding Byte | Add-Content -Path '%OutputFile%' -Encoding Byte; [byte[]]$newline = 13, 10; Add-Content -Path '%OutputFile%' -Value $newline -Encoding Byte }"

:: 2. 合并完成后直接用记事本打开结果
start "" "%OutputFile%"

:: 3. 退出脚本，不等待按键
exit