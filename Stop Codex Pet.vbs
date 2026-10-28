Option Explicit
Dim taskShell, taskFiles, taskFolder, taskPowerShell
Set taskShell = CreateObject("WScript.Shell")
Set taskFiles = CreateObject("Scripting.FileSystemObject")
taskFolder = taskFiles.GetParentFolderName(WScript.ScriptFullName)
taskPowerShell = taskShell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
taskShell.Run """" & taskPowerShell & """ -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & taskFolder & "\stop.ps1""", 0, False
