Set taskShell = CreateObject("WScript.Shell")
Set taskFiles = CreateObject("Scripting.FileSystemObject")
taskFolder = taskFiles.GetParentFolderName(WScript.ScriptFullName)
taskShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & taskFolder & "\stop.ps1""", 0, False
