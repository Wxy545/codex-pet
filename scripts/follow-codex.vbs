Option Explicit
Dim taskShell, taskFiles, taskRoot, taskPowerShell, taskCommand
Set taskShell = CreateObject("WScript.Shell")
Set taskFiles = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count > 0 Then
    taskRoot = WScript.Arguments(0)
Else
    taskRoot = taskFiles.GetParentFolderName(taskFiles.GetParentFolderName(WScript.ScriptFullName))
End If
taskPowerShell = taskShell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
taskCommand = """" & taskPowerShell & """ -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & taskRoot & "\scripts\follow-codex.ps1"" -AppRoot """ & taskRoot & """"
taskShell.Run taskCommand, 0, False
